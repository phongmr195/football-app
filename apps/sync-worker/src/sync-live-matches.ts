import { prisma } from "@football-app/database";
import type { GoalEvent } from "@football-app/realtime";
import { refreshLiveOddsIfNeeded } from "./live-odds";
import { generateMatchSummaryIfNeeded } from "./match-summary";
import { createAdapter } from "./provider";
import { createPublisher } from "./realtime";

export async function syncLiveMatches() {
  const adapter = createAdapter();
  const publisher = createPublisher();
  const matches = await adapter.fetchLiveMatches();

  for (const match of matches) {
    // Luôn filter theo CẢ provider VÀ id — giống hệt findCompetitionByExternalId/
    // findTeamByExternalId trong sync-catalog.ts (bug cùng loại đã tìm thấy và fix
    // 2026-08-14: filter chỉ theo id có thể match nhầm row của provider khác, silently
    // corrupt/overwrite data của match không liên quan).
    const dbMatch = await prisma.match.findFirst({
      where: {
        AND: [
          { externalRef: { path: ["provider"], equals: adapter.providerName } },
          { externalRef: { path: ["id"], equals: match.externalRef.id } },
        ],
      },
    });

    if (!dbMatch) {
      // TODO: match chưa tồn tại trong DB nghĩa là competition/team/season liên quan
      // cũng chưa được sync — cần chạy job sync danh mục (competitions/teams/seasons) trước.
      continue;
    }

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
      console.error(`syncLiveMatches: publish thất bại cho match ${dbMatch.id}`, err);
    }

    // Publish từng goal event SAU transaction, mỗi event bọc try/catch riêng (không phải 1 try/
    // catch bọc cả vòng for) — 1 event publish thất bại không được chặn các event còn lại của
    // cùng match (vd cả 2 đội cùng ghi bàn giữa 2 tick).
    for (const goalEvent of goalEvents) {
      try {
        await publisher.publishGoal(goalEvent);
      } catch (err) {
        console.error(
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
        console.error(`syncLiveMatches: generateMatchSummaryIfNeeded thất bại cho match ${dbMatch.id}`, err);
      });
    }

    // Odds auto-refresh cho match đang LIVE/HALFTIME — xem live-odds.ts (tự no-op khi
    // LIVE_ODDS_ENABLED không set, tự throttle 3 phút/match). KHÔNG await — cùng lý do
    // generateMatchSummaryIfNeeded ở trên, không làm chậm tick sync tiếp theo.
    if (match.status === "LIVE" || match.status === "HALFTIME") {
      void refreshLiveOddsIfNeeded(dbMatch).catch((err) => {
        console.error(`syncLiveMatches: refreshLiveOddsIfNeeded thất bại cho match ${dbMatch.id}`, err);
      });
    }
  }

  return { syncedCount: matches.length };
}
