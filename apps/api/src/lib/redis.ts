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
