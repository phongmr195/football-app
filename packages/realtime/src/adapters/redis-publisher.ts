import Redis from "ioredis";
import type { RealtimeTransport } from "../publisher.interface";
import type { GoalEvent, LiveUpdateEvent } from "../types";

function channelFor(matchId: string): string {
  // Kênh theo TỪNG match, không dùng 1 kênh global — registry kết nối ở apps/api vốn đã per-match
  // (subscribe/unsubscribe Redis map 1:1 vào lifecycle đó), không cần filter thừa phía consumer.
  return `live:match:${matchId}`;
}

// Kênh global CỐ ĐỊNH, không per-match — push notification (Phase 2 Bước 3) phải nổ ngay cả khi
// không có ai đang xem match qua WebSocket, nên cần 1 subscriber permanent (apps/api's
// goal-notifier) đăng ký đúng 1 kênh này suốt vòng đời process, thay vì subscribe/unsubscribe
// theo lifecycle của ConnectionRegistry như channelFor() ở trên.
const GOAL_EVENTS_CHANNEL = "goal-events";

export interface RedisPublisherOptions {
  redisUrl: string;
  // Injectable cho test (mirror FootballDataAdapterOptions.fetchImpl) — inject bất kỳ object nào
  // có method `publish` cùng chữ ký với ioredis, không cần kết nối Redis thật trong test.
  redisClient?: Pick<Redis, "publish">;
}

export class RedisPublisher implements RealtimeTransport {
  readonly transportName = "redis";

  private readonly client: Pick<Redis, "publish">;

  constructor(options: RedisPublisherOptions) {
    if (options.redisClient) {
      this.client = options.redisClient;
    } else {
      const client = new Redis(options.redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: false,
      });
      // Cùng lý do với apps/api/src/lib/redis.ts: 1 listener "error" no-op để tránh Node
      // "Unhandled 'error' event" crash tiến trình khi Redis down/unreachable — publish() vẫn
      // catch lỗi riêng bên dưới, listener này chỉ chặn crash ở tầng connection.
      client.on("error", (err) => {
        console.error("redis-publisher connection error (degrading gracefully)", err.message);
      });
      this.client = client;
    }
  }

  async publish(event: LiveUpdateEvent): Promise<void> {
    try {
      await this.client.publish(channelFor(event.matchId), JSON.stringify(event));
    } catch (err) {
      // KHÔNG throw — 1 lần publish thất bại (Redis down, timeout...) không được phép làm sync-
      // worker's syncLiveMatches() crash cả tick. Client vẫn có REST catch-up (Bước 1) + safety-
      // net poll ở apps/web khi WS/push không tới.
      console.error(
        `redis-publisher: publish thất bại cho match ${event.matchId} (degrading gracefully)`,
        err,
      );
    }
  }

  async publishGoal(event: GoalEvent): Promise<void> {
    try {
      await this.client.publish(GOAL_EVENTS_CHANNEL, JSON.stringify(event));
    } catch (err) {
      // Cùng triết lý với publish() ở trên — 1 lần publish goal-event thất bại không được phép
      // làm syncLiveMatches() crash cả tick, DB đã ghi đúng score rồi, chỉ mỗi việc push
      // notification bị bỏ lỡ (client vẫn thấy score mới qua REST/WS catch-up).
      console.error(
        `redis-publisher: publishGoal thất bại cho match ${event.matchId} (degrading gracefully)`,
        err,
      );
    }
  }
}
