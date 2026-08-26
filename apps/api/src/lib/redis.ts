import Redis from "ioredis";

// Redis cache là optional/degrade-êm — chưa setup Redis ở mọi môi trường (xem CLAUDE.md § Tech
// stack "Redis (cache — chưa setup)"). getClient() trả null nếu REDIS_URL không set, và MỌI lỗi
// runtime (mất kết nối, timeout...) đều bị catch trong cacheGet/cacheSet — cache chỉ là tối ưu
// tốc độ, không bao giờ được phép làm response 500 hay chặn route đọc từ Postgres.
let client: Redis | null | undefined;

function getClient(): Redis | null {
  if (client !== undefined) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    client = null;
    return client;
  }

  client = new Redis(url, {
    // maxRetriesPerRequest: 1 + enableOfflineQueue: false tránh lệnh cache bị treo/queue dài khi
    // Redis down hoặc chưa kết nối xong — muốn fail nhanh (reject gần như ngay lập tức) để
    // cacheGet/cacheSet rơi vào catch và degrade về Postgres, thay vì chờ ioredis tự retry theo
    // mặc định (thường 20 lần) hoặc chờ hết connectTimeout.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  // ioredis tự log lỗi ra console mặc định nếu không có listener "error" nào — nhưng vẫn cần 1
  // listener no-op ở đây để tránh Node "Unhandled 'error' event" crash tiến trình khi Redis down.
  client.on("error", (err) => {
    console.error("redis error (degrading gracefully)", err.message);
  });

  return client;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getClient();
  if (!redis) return null;

  try {
    const raw = await redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`cacheGet("${key}") failed (degrading gracefully)`, err);
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redis = getClient();
  if (!redis) return;

  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    console.error(`cacheSet("${key}") failed (degrading gracefully)`, err);
  }
}

export interface MatchCommentAuthor {
  id: string;
  displayName: string | null;
  // @token dùng để tag user này — username nếu có (user đăng ký username/password), không thì
  // slug từ displayName (Google/Facebook không có username) — null nếu không tag được (không có
  // cả 2). Xem apps/api/src/routes/match-comments.ts's computeMentionHandle().
  mentionHandle: string | null;
}

export interface MatchCommentBroadcast {
  id: string;
  matchId: string;
  content: string;
  mentionedUserIds: string[];
  createdAt: string;
  author: MatchCommentAuthor;
}

// Kênh riêng, KHÔNG dùng chung `live:match:${matchId}` (LiveUpdateEvent) — ws-server.ts's
// onFirstSubscriber() subscribe cả 2 kênh cùng lúc theo lifecycle ConnectionRegistry, forward
// dưới 2 message type khác nhau ("match.snapshot" vs "comment.new").
export function commentChannelFor(matchId: string): string {
  return `live:match:${matchId}:comments`;
}

// Cùng bug/fix pattern đã áp dụng ở redis-subscriber.ts's subscribeChannel() (2026-08-17) —
// getClient() connect lazyConnect:false ngay lúc gọi lần đầu, nhưng handshake TCP/Redis chưa
// chắc xong ở đúng tick gọi lệnh đầu tiên; enableOfflineQueue:false khiến lệnh bị reject ngay
// ("Stream isn't writeable and enableOfflineQueue options is false") thay vì tự chờ — verify
// thật 2026-08-26: publishComment thất bại 100% cho lần comment đầu tiên sau mỗi lần restart
// apps/api. Timeout 3s để không chờ vô hạn nếu Redis thật sự down (không bao giờ "ready").
function waitUntilReady(redis: Redis, timeoutMs = 3000): Promise<void> {
  if (redis.status === "ready") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    redis.once("ready", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Tự dựng publish ở đây (không dùng packages/realtime's RealtimeTransport) — interface đó CHỦ
// Ý chỉ dành cho sync-worker (xem doc comment ở publisher.interface.ts), route comment lại publish
// trực tiếp từ apps/api. Dùng lại đúng connection cache ở trên, không mở connection Redis thứ 2.
export async function publishComment(payload: MatchCommentBroadcast): Promise<void> {
  const redis = getClient();
  if (!redis) return;

  try {
    await waitUntilReady(redis);
    await redis.publish(commentChannelFor(payload.matchId), JSON.stringify(payload));
  } catch (err) {
    console.error(`publishComment thất bại cho match ${payload.matchId} (degrading gracefully)`, err);
  }
}
