// Sliding-window rate limiter — dùng để tránh vượt giới hạn request/phút của provider
// (API-Football Free plan: 10 request/phút, xem header x-ratelimit-limit trên response thật).
// Tách riêng khỏi adapter để test được logic throttle mà không cần gọi network thật.

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private timestamps: number[] = [];

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
    this.sleepFn = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  // Chờ (nếu cần) rồi "đăng ký" 1 request mới — gọi trước mỗi request thật ra ngoài.
  async acquire(): Promise<void> {
    const now = this.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length < this.maxRequests) {
      this.timestamps.push(now);
      return;
    }

    const oldest = this.timestamps[0] ?? now;
    const waitMs = this.windowMs - (now - oldest) + 50; // +50ms buffer tránh race đúng biên
    await this.sleepFn(waitMs);
    return this.acquire();
  }
}
