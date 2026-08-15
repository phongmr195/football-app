import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { prisma } from "@football-app/database";
import type { LiveUpdateEvent } from "@football-app/realtime";
import { ConnectionRegistry, type WebSocketLike } from "./connection-registry";
import { subscribeChannel, unsubscribeChannel } from "./redis-subscriber";

// Message protocol (wire contract dùng chung với apps/web — xem plan Phase 2 Bước 2 § Phần 3):
// Client -> Server: { type: "subscribe", matchId } | { type: "unsubscribe", matchId }
// Server -> Client: { type: "match.snapshot", matchId, data: LiveMatchState | LiveUpdateEvent | null }
//                   { type: "error", message } cho message sai format/không nhận diện được.
//
// KHÔNG có match.event/match.status_change — chưa có event ingestion thật (Bước 1 xác nhận
// /matches/:id/events gần như luôn rỗng), match.snapshot đã bao gồm status nên client tự derive
// được status change. Thêm match.event sau khi có event ingestion thật.
type ClientMessage =
  | { type: "subscribe"; matchId: string }
  | { type: "unsubscribe"; matchId: string };

const WS_OPEN = 1;

function channelFor(matchId: string): string {
  return `live:match:${matchId}`;
}

function safeSend(ws: WebSocketLike, payload: unknown): void {
  if (ws.readyState !== WS_OPEN) return;
  ws.send(JSON.stringify(payload));
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.type === "subscribe" || v.type === "unsubscribe") &&
    typeof v.matchId === "string" &&
    v.matchId.length > 0
  );
}

export function attachWebSocketServer(server: HttpServer): void {
  // 1 ConnectionRegistry dùng chung cho toàn bộ WS server (không phải per-connection) — registry
  // tự quản lý map 2 chiều matchId<->sockets, và callback dưới đây chỉ cần lo phần Redis
  // subscribe/unsubscribe, KHÔNG cần tự đếm subscriber (registry đã đảm bảo gọi đúng lúc 0->1/1->0).
  const registry = new ConnectionRegistry({
    onFirstSubscriber(matchId) {
      subscribeChannel(channelFor(matchId), (raw) => {
        let event: LiveUpdateEvent;
        try {
          event = JSON.parse(raw) as LiveUpdateEvent;
        } catch (err) {
          console.error(`ws-server: parse Redis message thất bại cho match ${matchId}`, err);
          return;
        }
        for (const ws of registry.getSubscribers(matchId)) {
          safeSend(ws, { type: "match.snapshot", matchId, data: event });
        }
      });
    },
    onLastUnsubscribe(matchId) {
      unsubscribeChannel(channelFor(matchId));
    },
  });

  const wss = new WebSocketServer({ server, path: "/live" });

  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        safeSend(ws, { type: "error", message: "invalid JSON" });
        return;
      }

      if (!isClientMessage(parsed)) {
        safeSend(ws, { type: "error", message: "unrecognized message" });
        return;
      }

      if (parsed.type === "unsubscribe") {
        registry.unsubscribe(parsed.matchId, ws);
        return;
      }

      // subscribe: đăng ký trong registry NGAY, rồi gửi match.snapshot ngay lập tức (query
      // Postgres tươi) — client không phải chờ tick Redis tiếp theo mới biết trạng thái hiện tại.
      const { matchId } = parsed;
      registry.subscribe(matchId, ws);
      prisma.liveMatchState
        .findUnique({ where: { matchId } })
        .then((liveState) => {
          safeSend(ws, { type: "match.snapshot", matchId, data: liveState ?? null });
        })
        .catch((err) => {
          console.error(`ws-server: query LiveMatchState thất bại cho match ${matchId}`, err);
          safeSend(ws, { type: "error", message: "failed to load initial snapshot" });
        });
    });

    ws.on("close", () => registry.cleanupSocket(ws));
    ws.on("error", () => registry.cleanupSocket(ws));
  });
}
