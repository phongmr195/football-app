import { describe, expect, it, vi } from "vitest";
import { ConnectionRegistry, type WebSocketLike } from "./connection-registry";

function fakeSocket(): WebSocketLike {
  return { readyState: 1, send: vi.fn() };
}

describe("ConnectionRegistry", () => {
  it("subscriber đầu tiên cho 1 matchId trigger onFirstSubscriber đúng 1 lần", () => {
    const onFirstSubscriber = vi.fn();
    const onLastUnsubscribe = vi.fn();
    const registry = new ConnectionRegistry({ onFirstSubscriber, onLastUnsubscribe });

    const wsA = fakeSocket();
    const wsB = fakeSocket();

    registry.subscribe("match-1", wsA);
    expect(onFirstSubscriber).toHaveBeenCalledTimes(1);
    expect(onFirstSubscriber).toHaveBeenCalledWith("match-1");

    // Subscriber thứ 2 cho CÙNG matchId -> KHÔNG re-trigger onFirstSubscriber.
    registry.subscribe("match-1", wsB);
    expect(onFirstSubscriber).toHaveBeenCalledTimes(1);

    expect(registry.getSubscribers("match-1").size).toBe(2);
    expect(onLastUnsubscribe).not.toHaveBeenCalled();
  });

  it("bỏ subscriber cuối cùng của 1 matchId trigger onLastUnsubscribe", () => {
    const onFirstSubscriber = vi.fn();
    const onLastUnsubscribe = vi.fn();
    const registry = new ConnectionRegistry({ onFirstSubscriber, onLastUnsubscribe });

    const wsA = fakeSocket();
    const wsB = fakeSocket();
    registry.subscribe("match-1", wsA);
    registry.subscribe("match-1", wsB);

    registry.unsubscribe("match-1", wsA);
    expect(onLastUnsubscribe).not.toHaveBeenCalled(); // vẫn còn wsB
    expect(registry.getSubscribers("match-1").size).toBe(1);

    registry.unsubscribe("match-1", wsB);
    expect(onLastUnsubscribe).toHaveBeenCalledTimes(1);
    expect(onLastUnsubscribe).toHaveBeenCalledWith("match-1");
    expect(registry.getSubscribers("match-1").size).toBe(0);
  });

  it("cleanupSocket() gỡ 1 socket khỏi MỌI matchId nó từng subscribe", () => {
    const onFirstSubscriber = vi.fn();
    const onLastUnsubscribe = vi.fn();
    const registry = new ConnectionRegistry({ onFirstSubscriber, onLastUnsubscribe });

    const ws = fakeSocket();
    const otherWs = fakeSocket();
    registry.subscribe("match-1", ws);
    registry.subscribe("match-2", ws);
    registry.subscribe("match-2", otherWs); // match-2 còn subscriber khác sau khi cleanup ws

    registry.cleanupSocket(ws);

    expect(registry.getSubscribers("match-1").size).toBe(0);
    expect(registry.getSubscribers("match-2").size).toBe(1);
    expect(registry.getSubscribers("match-2").has(otherWs)).toBe(true);

    // match-1 không còn ai -> onLastUnsubscribe được gọi cho match-1; match-2 vẫn còn otherWs nên
    // KHÔNG gọi onLastUnsubscribe cho match-2.
    expect(onLastUnsubscribe).toHaveBeenCalledTimes(1);
    expect(onLastUnsubscribe).toHaveBeenCalledWith("match-1");

    // cleanupSocket() lần 2 trên socket đã dọn sạch -> no-op, không throw, không gọi thêm callback.
    registry.cleanupSocket(ws);
    expect(onLastUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe() 1 matchId chưa từng subscribe -> no-op, không throw", () => {
    const onFirstSubscriber = vi.fn();
    const onLastUnsubscribe = vi.fn();
    const registry = new ConnectionRegistry({ onFirstSubscriber, onLastUnsubscribe });

    expect(() => registry.unsubscribe("unknown-match", fakeSocket())).not.toThrow();
    expect(onLastUnsubscribe).not.toHaveBeenCalled();
  });
});
