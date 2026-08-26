import { prisma } from "@football-app/database";
import type { GoalEvent } from "@football-app/realtime";
import { getMessaging } from "firebase-admin/messaging";
import { getFirebaseApp } from "../middleware/auth";
import { logError } from "../logger";
import { subscribeChannel } from "./redis-subscriber";

// Kênh global CỐ ĐỊNH (khác "live:match:*" per-match, xem RedisPublisher.publishGoal) — subscriber
// permanent, đăng ký đúng 1 lần suốt vòng đời process, KHÔNG phụ thuộc có browser nào đang xem
// match qua WebSocket (xem plan Phase 2 Bước 3 § Context).
const GOAL_EVENTS_CHANNEL = "goal-events";

let started = false;

function isGoalEvent(value: unknown): value is GoalEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.matchId === "string" &&
    typeof v.teamId === "string" &&
    typeof v.homeScore === "number" &&
    typeof v.awayScore === "number" &&
    typeof v.scoredAt === "string"
  );
}

// Reverse-lookup FavoriteTeam theo teamId vừa ghi bàn, include user.notificationSetting +
// user.devices — coi THIẾU row NotificationSetting = goalAlerts: true (đúng @default(true) của
// schema, xem plan Phase 2 Bước 3 § A4), không cần provision NotificationSetting trước cho mọi
// user.
async function findNotifiableFavorites(teamId: string) {
  return prisma.favoriteTeam.findMany({
    where: {
      teamId,
      user: {
        OR: [{ notificationSetting: null }, { notificationSetting: { goalAlerts: true } }],
      },
    },
    include: { user: { include: { devices: true } } },
  });
}

async function handleGoalEvent(event: GoalEvent): Promise<void> {
  let favorites: Awaited<ReturnType<typeof findNotifiableFavorites>>;
  try {
    favorites = await findNotifiableFavorites(event.teamId);
  } catch (err) {
    void logError(`goal-notifier: query FavoriteTeam thất bại cho team ${event.teamId}`, err);
    return;
  }

  const title = "Bàn thắng!";
  const body = `Đội bạn yêu thích vừa ghi bàn — tỉ số hiện tại ${event.homeScore}-${event.awayScore}`;
  const data = {
    type: "goal",
    matchId: event.matchId,
    teamId: event.teamId,
    homeScore: String(event.homeScore),
    awayScore: String(event.awayScore),
  };

  for (const favorite of favorites) {
    const { user } = favorite;

    // 1 lỗi xử lý cho 1 user không được throw ra ngoài / chặn user khác — bọc try/catch riêng
    // từng user (xem plan Phase 2 Bước 3 § A4).
    try {
      // Luôn ghi Notification (bản ghi in-app, xem NotificationBell.tsx) TRƯỚC, KHÔNG phụ thuộc
      // user có Device nào hay không — bug thật đã sửa 2026-08-24: trước đây `continue` sớm khi
      // devices rỗng khiến user chưa từng bật push trên browser nào (hoặc đang offline lúc ghi
      // bàn) không có gì để xem lại khi mở web sau đó, dù họ có favorite đội này và bật
      // goalAlerts. Push FCM chỉ là kênh gửi THÊM khi có device, không phải điều kiện để có bản
      // ghi in-app.
      const notification = await prisma.notification.create({
        data: { userId: user.id, type: "goal", title, body, data },
      });

      if (user.devices.length === 0) continue; // không có device -> chỉ ghi in-app, không gửi FCM

      const tokens = user.devices.map((d) => d.fcmToken);
      const response = await getMessaging(getFirebaseApp()).sendEachForMulticast({
        tokens,
        notification: { title, body },
        data,
      });

      // 1 NotificationLog row/token — NotificationLog không có cột riêng lưu token (chỉ audit
      // SENT/FAILED theo channel), nên không cần map lại response<->token ở đây.
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
          `goal-notifier: ${failedCount}/${tokens.length} FCM send thất bại cho user ${user.id}`,
        );
      }
    } catch (err) {
      void logError(`goal-notifier: xử lý goal event thất bại cho user ${user.id}`, err);
    }
  }
}

// startGoalNotifier() PHẢI được gọi đúng 1 lần lúc boot (xem index.ts, cạnh
// attachWebSocketServer) — guard `started` chống double-subscribe nếu vô tình gọi lại (vd hot-
// reload trong test, hay code gọi nhầm 2 lần).
export function startGoalNotifier(): void {
  if (started) return;
  started = true;

  subscribeChannel(GOAL_EVENTS_CHANNEL, (raw) => {
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch (err) {
      void logError("goal-notifier: parse Redis message thất bại", err);
      return;
    }

    if (!isGoalEvent(event)) {
      void logError("goal-notifier: message không đúng shape GoalEvent, bỏ qua", event);
      return;
    }

    handleGoalEvent(event).catch((err) => {
      // Lớp phòng thủ cuối — handleGoalEvent() đã tự catch lỗi nội bộ theo user, nhưng vẫn bọc ở
      // đây để 1 lỗi bất ngờ (bug tương lai) không làm subscriber callback throw ra ngoài
      // ioredis's "message" event handler và crash process.
      void logError("goal-notifier: handleGoalEvent thất bại (không throw ra ngoài subscriber)", err);
    });
  });
}

// Export cho test — gọi trực tiếp không qua Redis subscribe, để test seed DB + assert side-effect
// (Notification/NotificationLog rows, sendEachForMulticast được gọi) mà không cần Redis thật.
export { handleGoalEvent };
