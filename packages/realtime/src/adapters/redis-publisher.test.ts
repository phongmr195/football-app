import { describe, expect, it, vi } from "vitest";
import { RedisPublisher } from "./redis-publisher";
import type { LiveUpdateEvent } from "../types";

function makeEvent(overrides: Partial<LiveUpdateEvent> = {}): LiveUpdateEvent {
  return {
    matchId: "match-1",
    status: "LIVE",
    minute: 37,
    homeScore: 1,
    awayScore: 0,
    updatedAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("RedisPublisher", () => {
  it("publish() gọi đúng kênh live:match:<matchId> kèm JSON payload đúng", async () => {
    const publishMock = vi.fn().mockResolvedValue(1);
    const publisher = new RedisPublisher({
      redisUrl: "redis://unused-in-test",
      redisClient: { publish: publishMock },
    });

    const event = makeEvent();
    await publisher.publish(event);

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith("live:match:match-1", JSON.stringify(event));
  });

  it("publish() KHÔNG throw khi client.publish() reject (Redis down)", async () => {
    const publishMock = vi.fn().mockRejectedValue(new Error("connection refused"));
    const publisher = new RedisPublisher({
      redisUrl: "redis://unused-in-test",
      redisClient: { publish: publishMock },
    });

    await expect(publisher.publish(makeEvent())).resolves.toBeUndefined();
  });

  it("transportName là 'redis'", () => {
    const publisher = new RedisPublisher({
      redisUrl: "redis://unused-in-test",
      redisClient: { publish: vi.fn() },
    });
    expect(publisher.transportName).toBe("redis");
  });
});
