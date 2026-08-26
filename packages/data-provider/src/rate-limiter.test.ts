import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter";

// Dùng fake clock/sleep tự viết (không phải vi.useFakeTimers) để test logic throttle
// mà không phụ thuộc real time — sleep() ở đây tua clock luôn thay vì chờ thật.
function makeFakeClock() {
  let time = 0;
  const sleepCalls: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
      time += ms;
    },
    sleepCalls,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("RateLimiter", () => {
  it("cho phép tối đa maxRequests trong windowMs mà không cần chờ", async () => {
    const clock = makeFakeClock();
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(clock.sleepCalls).toHaveLength(0); // chưa vượt limit, không cần chờ
  });

  it("chờ đúng tới khi request cũ nhất rớt khỏi window, không chặn vô hạn", async () => {
    const clock = makeFakeClock();
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    await limiter.acquire(); // t=0
    clock.advance(100);
    await limiter.acquire(); // t=100 — đã đủ 2 request trong window

    await limiter.acquire(); // request thứ 3 — phải chờ tới t>=1000 (request đầu rớt khỏi window)

    expect(clock.sleepCalls.length).toBeGreaterThan(0);
    expect(clock.now()).toBeGreaterThanOrEqual(1000);
  });

  it("không chờ nếu request cũ đã tự rớt khỏi window (thời gian trôi qua tự nhiên)", async () => {
    const clock = makeFakeClock();
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    await limiter.acquire();

    clock.advance(1100); // window đã trôi qua hết

    await limiter.acquire(); // không cần chờ vì 2 request cũ đã ngoài window

    expect(clock.sleepCalls).toHaveLength(0);
  });
});
