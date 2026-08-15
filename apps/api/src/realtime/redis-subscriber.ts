import Redis from "ioredis";

// Connection ioredis RIÊNG BIỆT, dành riêng cho subscribe — KHÔNG dùng chung client cache ở
// ../lib/redis.ts. Lý do: 1 client ioredis sau khi gọi .subscribe()/.psubscribe() chuyển hẳn sang
// "subscriber mode", không còn dùng được cho lệnh thường (GET/SET/PUBLISH...) nữa — 2 connection
// riêng là bắt buộc, không phải trùng lặp thừa. Cùng lazy-singleton + "error" no-op listener style
// với ../lib/redis.ts (xem file đó để so sánh).
//
// Degrade: REDIS_URL không set -> subscribeChannel()/unsubscribeChannel() no-op. WS vẫn accept
// connection + gửi snapshot ban đầu (query Postgres trực tiếp, xem ws-server.ts), chỉ không có
// push tiếp theo qua Redis — client tự có safety-net poll (apps/web) để bù.
let client: Redis | null | undefined;

function getClient(): Redis | null {
  if (client !== undefined) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    client = null;
    return client;
  }

  client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  client.on("error", (err) => {
    console.error("redis-subscriber error (degrading gracefully)", err.message);
  });

  return client;
}

// Map channel -> listener đã đăng ký, để unsubscribeChannel() gỡ đúng listener (ioredis
// "message" event dùng chung cho MỌI channel đã subscribe trên 1 connection, nên phải tự lọc
// theo channel ở tầng này thay vì dựa vào ioredis tách sẵn).
const listeners = new Map<string, (raw: string) => void>();
let messageHandlerAttached = false;

function ensureMessageHandler(redis: Redis): void {
  if (messageHandlerAttached) return;
  messageHandlerAttached = true;
  redis.on("message", (channel: string, message: string) => {
    const listener = listeners.get(channel);
    if (listener) listener(message);
  });
}

export function subscribeChannel(channel: string, onMessage: (raw: string) => void): void {
  const redis = getClient();
  if (!redis) return;

  ensureMessageHandler(redis);
  listeners.set(channel, onMessage);
  redis.subscribe(channel).catch((err) => {
    console.error(`redis-subscriber: subscribe("${channel}") thất bại (degrading gracefully)`, err);
  });
}

export function unsubscribeChannel(channel: string): void {
  const redis = getClient();
  listeners.delete(channel);
  if (!redis) return;

  redis.unsubscribe(channel).catch((err) => {
    console.error(`redis-subscriber: unsubscribe("${channel}") thất bại (degrading gracefully)`, err);
  });
}
