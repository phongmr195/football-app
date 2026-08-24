import { prisma } from "@football-app/database";
import type { MatchFinishedEvent } from "@football-app/realtime";
import { getMessaging } from "firebase-admin/messaging";
import { getFirebaseApp } from "../middleware/auth";
import { logError } from "../logger";
import { subscribeChannel } from "./redis-subscriber";

// Kênh global riêng thứ 2 (khác GOAL_EVENTS_CHANNEL ở goal-notifier.ts) — cùng lý do permanent
// subscriber, xem RedisPublisher.publishMatchFinished.
const MATCH_FINISHED_EVENTS_CHANNEL = "match-finished-events";

let started = false;

function isMatchFinishedEvent(value: unknown): value is MatchFinishedEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.matchId === "string" &&
    typeof v.homeTeamId === "string" &&
    typeof v.awayTeamId === "string" &&
    typeof v.homeTeamName === "string" &&
    typeof v.awayTeamName === "string" &&
    typeof v.homeScore === "number" &&
    typeof v.awayScore === "number" &&
    typeof v.finishedAt === "string"
  );
}

// Reverse-lookup FavoriteTeam cho CẢ 2 đội trong 1 query (khác goal-notifier's 1 teamId) — 1 user
// yêu thích 1 trong 2 đội đá trận này đều nhận noti kết quả. Coi THIẾU row NotificationSetting =
// matchResultAlerts: true (đúng @default(true) của schema), cùng convention findNotifiableFavorites
// ở goal-notifier.ts.
async function findNotifiableFavorites(homeTeamId: string, awayTeamId: string) {
  return prisma.favoriteTeam.findMany({
    where: {
      teamId: { in: [homeTeamId, awayTeamId] },
      user: {
        OR: [{ notificationSetting: null }, { notificationSetting: { matchResultAlerts: true } }],
      },
    },
    include: { user: { include: { devices: true } } },
  });
}

async function handleMatchFinishedEvent(event: MatchFinishedEvent): Promise<void> {
  let favoriteRows: Awaited<ReturnType<typeof findNotifiableFavorites>>;
  try {
    favoriteRows = await findNotifiableFavorites(event.homeTeamId, event.awayTeamId);
  } catch (err) {
    void logError(`match-finished-notifier: query FavoriteTeam thất bại cho match ${event.matchId}`, err);
    return;
  }

  // Dedupe theo userId — khác goal-notifier.ts (1 teamId/query nên không thể trùng), ở đây user
  // favorite CẢ 2 đội đá trận này sẽ khớp 2 FavoriteTeam row, sẽ nhận noti 2 lần y hệt nhau nếu
  // không lọc trước khi loop.
  const favorites = [...new Map(favoriteRows.map((f) => [f.user.id, f])).values()];

  const title = "Trận đấu kết thúc";
  const body = `${event.homeTeamName} ${event.homeScore} - ${event.awayScore} ${event.awayTeamName}`;

  for (const favorite of favorites) {
    const { user } = favorite;
    if (user.devices.length === 0) continue; // không có device nào -> bỏ qua êm, không phải lỗi

    // 1 lỗi gửi FCM cho 1 user không được throw ra ngoài / chặn user khác — cùng convention
    // goal-notifier.ts.
    try {
      const tokens = user.devices.map((d) => d.fcmToken);
      const data = {
        type: "match_result",
        matchId: event.matchId,
        homeTeamId: event.homeTeamId,
        awayTeamId: event.awayTeamId,
        homeScore: String(event.homeScore),
        awayScore: String(event.awayScore),
      };

      const response = await getMessaging(getFirebaseApp()).sendEachForMulticast({
        tokens,
        notification: { title, body },
        data,
      });

      const notification = await prisma.notification.create({
        data: {
          userId: user.id,
          type: "match_result",
          title,
          body,
          data,
        },
      });

      await prisma.notificationLog.createMany({
        data: response.responses.map((r) => ({
          notificationId: notification.id,
          channel: "FCM" as const,
          status: r.success ? ("SENT" as const) : ("FAILED" as const),
          error: r.success ? null : (r.error?.message ?? "unknown FCM error"),
        })),
      });

      const failedCount = response.responses.filter((r) => !r.success).length;
      if (failedCount > 0) {
        void logError(
          `match-finished-notifier: ${failedCount}/${tokens.length} FCM send thất bại cho user ${user.id}`,
        );
      }
    } catch (err) {
      void logError(`match-finished-notifier: xử lý match-finished event thất bại cho user ${user.id}`, err);
    }
  }
}

// startMatchFinishedNotifier() PHẢI được gọi đúng 1 lần lúc boot (xem index.ts) — guard `started`
// cùng convention startGoalNotifier().
export function startMatchFinishedNotifier(): void {
  if (started) return;
  started = true;

  subscribeChannel(MATCH_FINISHED_EVENTS_CHANNEL, (raw) => {
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch (err) {
      void logError("match-finished-notifier: parse Redis message thất bại", err);
      return;
    }

    if (!isMatchFinishedEvent(event)) {
      void logError("match-finished-notifier: message không đúng shape MatchFinishedEvent, bỏ qua", event);
      return;
    }

    handleMatchFinishedEvent(event).catch((err) => {
      // Lớp phòng thủ cuối — cùng lý do goal-notifier.ts's handleGoalEvent().catch().
      void logError(
        "match-finished-notifier: handleMatchFinishedEvent thất bại (không throw ra ngoài subscriber)",
        err,
      );
    });
  });
}

// Export cho test — gọi trực tiếp không qua Redis subscribe, cùng convention goal-notifier.ts.
export { handleMatchFinishedEvent };
