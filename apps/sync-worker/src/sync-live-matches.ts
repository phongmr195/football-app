import { prisma } from "@football-app/database";
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
  }

  return { syncedCount: matches.length };
}
