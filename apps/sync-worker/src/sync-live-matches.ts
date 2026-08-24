import type { CanonicalMatch, DataProviderAdapter } from "@football-app/data-provider";
import { prisma } from "@football-app/database";
import type { GoalEvent, RealtimeTransport } from "@football-app/realtime";
import { readExternalRefId, refreshLiveOddsIfNeeded } from "./live-odds";
import { logError } from "./logger";
import { generateMatchSummaryIfNeeded } from "./match-summary";
import { createAdapter } from "./provider";
import { createPublisher } from "./realtime";
import { refreshTopScorersIfNeeded, syncStandingsFromMatches } from "./sync-catalog";

// Kèm tên đội (select tối thiểu) — cần cho MatchFinishedEvent's homeTeamName/awayTeamName mà
// không phải query thêm 1 lần nữa trong applyMatchUpdate().
const DB_MATCH_INCLUDE = {
  homeTeam: { select: { name: true } },
  awayTeam: { select: { name: true } },
} as const;
type DbMatch = NonNullable<
  Awaited<ReturnType<typeof prisma.match.findFirst<{ include: typeof DB_MATCH_INCLUDE }>>>
>;

// Match League thường (không hiệp phụ) kết thúc ~1h45-2h sau kickoff (90' + bù giờ + nghỉ giữa
// giờ) — 2h dư margin ~15-30 phút cho case đó. Match VẪN đang live thật (hiệp phụ, hoặc chỉ chậm
// bù giờ) không bị ảnh hưởng bởi ngưỡng này: nó vẫn nằm trong fetchLiveMatches() tick hiện tại nên
// bị loại khỏi vòng reconcile qua fetchedExternalIds phía dưới, KHÔNG bao giờ chạm nhánh này —
// threshold ngắn chỉ tăng tốc phát hiện match ĐÃ rớt khỏi feed (đã FINISHED), không có rủi ro báo
// sai match đang live thật. Ban đầu để 4h (quá dài) — verify thật 2026-08-23: 3 match Premier
// League/Ligue 1 kickoff 13:00 UTC đã FINISHED thật (confirm qua fetchMatch() trực tiếp) lúc
// kickoff+2h17m nhưng chưa đủ 4h nên vẫn hiện LIVE sai trên web, hạ xuống 2h để user không phải
// đợi lâu vậy mới thấy status đúng.
const STALE_LIVE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

async function findDbMatchByExternalId(
  adapter: DataProviderAdapter,
  externalId: string,
): Promise<DbMatch | null> {
  // Luôn filter theo CẢ provider VÀ id — giống hệt findCompetitionByExternalId/
  // findTeamByExternalId trong sync-catalog.ts (bug cùng loại đã tìm thấy và fix
  // 2026-08-14: filter chỉ theo id có thể match nhầm row của provider khác, silently
  // corrupt/overwrite data của match không liên quan).
  return prisma.match.findFirst({
    where: {
      AND: [
        { externalRef: { path: ["provider"], equals: adapter.providerName } },
        { externalRef: { path: ["id"], equals: externalId } },
      ],
    },
    include: DB_MATCH_INCLUDE,
  });
}

async function applyMatchUpdate(
  dbMatch: DbMatch,
  match: CanonicalMatch,
  publisher: RealtimeTransport,
  adapter: DataProviderAdapter,
) {
  // Diff score TRƯỚC khi transaction ghi đè dbMatch.homeScore/awayScore — chỉ TĂNG mới tính là
  // bàn thắng (giảm là provider sửa số liệu, không phải bàn thắng thật). Tick đầu tiên quan sát
  // 1 match (dbMatch.homeScore null từ lúc còn SCHEDULED, match.homeScore về 0 lúc kickoff)
  // không false-positive vì `0 > 0` là false. Không dùng else-if giữa 2 đội — cả 2 có thể cùng
  // ghi bàn giữa 2 tick polling (xem plan Phase 2 Bước 3 § A2).
  const newHomeScore = match.homeScore ?? 0;
  const newAwayScore = match.awayScore ?? 0;
  const oldHomeScore = dbMatch.homeScore ?? 0;
  const oldAwayScore = dbMatch.awayScore ?? 0;

  const goalEvents: GoalEvent[] = [];
  if (newHomeScore > oldHomeScore) {
    goalEvents.push({
      matchId: dbMatch.id,
      teamId: dbMatch.homeTeamId,
      homeScore: newHomeScore,
      awayScore: newAwayScore,
      scoredAt: new Date().toISOString(),
    });
  }
  if (newAwayScore > oldAwayScore) {
    goalEvents.push({
      matchId: dbMatch.id,
      teamId: dbMatch.awayTeamId,
      homeScore: newHomeScore,
      awayScore: newAwayScore,
      scoredAt: new Date().toISOString(),
    });
  }

  // Ghi cả Match (status/score) lẫn LiveMatchState trong 1 transaction — các trang /matches
  // list/detail (Phase 1) đọc Match.status trực tiếp, không đọc LiveMatchState, nên nếu chỉ
  // upsert LiveMatchState thì UI vẫn hiển thị SCHEDULED/stale trong lúc trận đang live.
  await prisma.$transaction([
    prisma.match.update({
      where: { id: dbMatch.id },
      data: {
        status: match.status,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
      },
    }),
    prisma.liveMatchState.upsert({
      where: { matchId: dbMatch.id },
      create: {
        matchId: dbMatch.id,
        status: match.status,
        minute: match.minute,
        homeScore: match.homeScore ?? 0,
        awayScore: match.awayScore ?? 0,
      },
      update: {
        status: match.status,
        minute: match.minute,
        homeScore: match.homeScore ?? 0,
        awayScore: match.awayScore ?? 0,
      },
    }),
  ]);

  // Publish NGAY SAU transaction, dùng đúng data vừa ghi (không đọc lại DB) — RealtimeTransport
  // implementations (RedisPublisher, no-op) tự catch lỗi/no-op nội bộ và không bao giờ throw,
  // nhưng vẫn bọc try/catch ở đây làm lớp phòng thủ thứ 2: 1 lỗi publish (bug ở transport khác
  // trong tương lai, hay implementation vi phạm contract) không được phép làm cả tick sync live-
  // match thất bại — DB đã ghi đúng rồi, chỉ mỗi việc push real-time bị bỏ lỡ.
  try {
    await publisher.publish({
      matchId: dbMatch.id,
      status: match.status,
      minute: match.minute ?? null,
      homeScore: match.homeScore ?? 0,
      awayScore: match.awayScore ?? 0,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    void logError(`syncLiveMatches: publish thất bại cho match ${dbMatch.id}`, err);
  }

  // Publish từng goal event SAU transaction, mỗi event bọc try/catch riêng (không phải 1 try/
  // catch bọc cả vòng for) — 1 event publish thất bại không được chặn các event còn lại của
  // cùng match (vd cả 2 đội cùng ghi bàn giữa 2 tick).
  for (const goalEvent of goalEvents) {
    try {
      await publisher.publishGoal(goalEvent);
    } catch (err) {
      void logError(
        `syncLiveMatches: publishGoal thất bại cho match ${dbMatch.id}, team ${goalEvent.teamId}`,
        err,
      );
    }
  }

  // Trigger AI match summary khi match VỪA chuyển sang FINISHED (đọc dbMatch.status TRƯỚC
  // transaction ở trên, giống cách diff score cho goalEvents) — đây là đường "nhanh" (bắt được
  // ngay nếu provider còn trả match này trong fetchLiveMatches() lúc vừa kết thúc);
  // sync-catalog.ts's syncMatches() là đường "chắc chắn" (re-sync định kỳ, không phụ thuộc match
  // có được live-poll đúng lúc hay không). generateMatchSummaryIfNeeded tự idempotent (guard
  // bằng AiMatchSummary.matchId) nên an toàn khi cả 2 đường cùng trigger. KHÔNG await — job AI
  // chạy nền, không làm chậm tick sync tiếp theo (xem plan Phase 5 § "không block API").
  if (dbMatch.status !== "FINISHED" && match.status === "FINISHED") {
    void generateMatchSummaryIfNeeded(dbMatch.id).catch((err) => {
      void logError(`syncLiveMatches: generateMatchSummaryIfNeeded thất bại cho match ${dbMatch.id}`, err);
    });

    // Bảng xếp hạng mùa hiện tại trước đây CHỈ cập nhật khi admin bấm sync tay (xem
    // syncStandingsFromMatches() trong sync-catalog.ts) — trigger ngay khi có match VỪA
    // FINISHED, tính hoàn toàn từ Match local (KHÔNG gọi provider) nên an toàn gọi ở đây, cùng
    // lý do/pattern generateMatchSummaryIfNeeded ngay trên. KHÔNG await, không chặn tick tiếp theo.
    void syncStandingsFromMatches(dbMatch.seasonId).catch((err) => {
      void logError(`syncLiveMatches: syncStandingsFromMatches thất bại cho season ${dbMatch.seasonId}`, err);
    });

    // Top scorers/assists (PlayerStatistics.goals/assists) — cùng vấn đề "chỉ cập nhật khi sync
    // tay" như standings, nhưng KHÔNG tính được từ Match local (không đủ data theo cầu thủ cho
    // toàn mùa, xem comment đầy đủ ở refreshTopScorersIfNeeded()) nên vẫn gọi provider, có
    // throttle riêng theo competition+season để không gọi thừa khi nhiều match cùng giải/mùa
    // FINISHED gần nhau.
    void refreshTopScorersIfNeeded(adapter, dbMatch.competitionId, dbMatch.seasonId).catch((err) => {
      void logError(
        `syncLiveMatches: refreshTopScorersIfNeeded thất bại cho competition ${dbMatch.competitionId}`,
        err,
      );
    });

    // Push noti "trận đấu kết thúc" cho user có đội yêu thích đá trận này (apps/api's
    // match-finished-notifier.ts subscribe kênh này) — cùng lý do KHÔNG await với goalEvents ở
    // trên, chỉ khác kênh global riêng thay vì per-match.
    try {
      await publisher.publishMatchFinished({
        matchId: dbMatch.id,
        homeTeamId: dbMatch.homeTeamId,
        awayTeamId: dbMatch.awayTeamId,
        homeTeamName: dbMatch.homeTeam.name,
        awayTeamName: dbMatch.awayTeam.name,
        homeScore: newHomeScore,
        awayScore: newAwayScore,
        finishedAt: new Date().toISOString(),
      });
    } catch (err) {
      void logError(`syncLiveMatches: publishMatchFinished thất bại cho match ${dbMatch.id}`, err);
    }
  }

  // Odds auto-refresh cho match đang LIVE/HALFTIME — xem live-odds.ts (tự no-op khi
  // LIVE_ODDS_ENABLED không set, tự throttle 3 phút/match). KHÔNG await — cùng lý do
  // generateMatchSummaryIfNeeded ở trên, không làm chậm tick sync tiếp theo.
  if (match.status === "LIVE" || match.status === "HALFTIME") {
    void refreshLiveOddsIfNeeded(dbMatch).catch((err) => {
      void logError(`syncLiveMatches: refreshLiveOddsIfNeeded thất bại cho match ${dbMatch.id}`, err);
    });
  }
}

export async function syncLiveMatches() {
  const adapter = createAdapter();
  const publisher = createPublisher();
  const matches = await adapter.fetchLiveMatches();
  const fetchedExternalIds = new Set(matches.map((match) => match.externalRef.id));

  for (const match of matches) {
    const dbMatch = await findDbMatchByExternalId(adapter, match.externalRef.id);
    if (!dbMatch) {
      // TODO: match chưa tồn tại trong DB nghĩa là competition/team/season liên quan
      // cũng chưa được sync — cần chạy job sync danh mục (competitions/teams/seasons) trước.
      continue;
    }
    await applyMatchUpdate(dbMatch, match, publisher, adapter);
  }

  // Reconcile match kẹt LIVE/HALFTIME nhưng KHÔNG còn nằm trong fetchLiveMatches() tick này —
  // bug thật tìm thấy 2026-08-23: nếu match rớt khỏi feed "live" của provider đúng lúc service
  // gặp downtime/redeploy (miss đúng tick chuyển sang FINISHED), match đó sẽ KẸT VĨNH VIỄN ở
  // LIVE — vòng for ở trên chỉ update match có mặt trong fetchLiveMatches(), không có cơ chế nào
  // khác tự sửa lại match đã "rơi ra ngoài" theo dõi. Chỉ xét match kickoff đã quá
  // STALE_LIVE_THRESHOLD_MS để không gọi thừa cho match vừa chuyển LIVE giữa 2 tick.
  const staleMatches = await prisma.match.findMany({
    where: {
      status: { in: ["LIVE", "HALFTIME"] },
      kickoffAt: { lt: new Date(Date.now() - STALE_LIVE_THRESHOLD_MS) },
      externalRef: { path: ["provider"], equals: adapter.providerName },
    },
    include: DB_MATCH_INCLUDE,
  });

  let reconciledCount = 0;
  for (const dbMatch of staleMatches) {
    const externalId = readExternalRefId(dbMatch.externalRef);
    if (!externalId || fetchedExternalIds.has(externalId)) continue;
    try {
      const freshMatch = await adapter.fetchMatch(externalId);
      await applyMatchUpdate(dbMatch, freshMatch, publisher, adapter);
      reconciledCount += 1;
    } catch (err) {
      void logError(`syncLiveMatches: reconcile match kẹt LIVE ${dbMatch.id} thất bại`, err);
    }
  }

  return { syncedCount: matches.length, reconciledCount };
}
