import type { RealtimeTransport } from "@football-app/realtime";
import { RedisPublisher } from "@football-app/realtime";

// createPublisher() PHẢI memoized (singleton qua biến module-level) — syncLiveMatches() được gọi
// mỗi tick polling (mặc định 30s, xem poll-live-matches.ts), và RedisPublisher giữ 1 connection
// ioredis thật (khác FootballDataAdapter — adapter đó không giữ connection nên tạo mới mỗi tick
// vô hại). Tạo mới RedisPublisher mỗi tick sẽ leak 1 connection Redis mỗi 30s.
let publisher: RealtimeTransport | undefined;

// No-op publisher khi REDIS_URL không set — cùng triết lý "Redis optional toàn repo" như
// apps/api/src/lib/redis.ts: publish() resolve êm, không throw, không cần Redis chạy ở mọi môi
// trường local dev.
const noopPublisher: RealtimeTransport = {
  transportName: "noop",
  async publish() {
    // no-op
  },
};

export function createPublisher(): RealtimeTransport {
  if (publisher) return publisher;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    publisher = noopPublisher;
    return publisher;
  }

  const transport = process.env.REALTIME_PUBLISHER ?? "redis";
  switch (transport) {
    case "redis":
      publisher = new RedisPublisher({ redisUrl });
      break;
    default:
      throw new Error(
        `REALTIME_PUBLISHER không hợp lệ: "${transport}" — chỉ hỗ trợ "redis"`,
      );
  }

  return publisher;
}
