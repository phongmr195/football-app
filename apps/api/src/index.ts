import "./load-env";
import type { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { app } from "./app";
import { attachWebSocketServer } from "./realtime/ws-server";
import { startGoalNotifier } from "./realtime/goal-notifier";
import { startMatchFinishedNotifier } from "./realtime/match-finished-notifier";

const port = Number(process.env.PORT ?? 3000);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});

// serve()'s return type (ServerType) là union http.Server | http2.Server | http2.SecureServer —
// app hiện không truyền config http2/https nào (xem Options ở @hono/node-server) nên runtime thật
// luôn là plain node:http Server; cast ở đây để attachWebSocketServer() có type chặt (http.Server)
// thay vì phải nới lỏng ConnectionRegistry/ws-server.ts cho cả 3 loại server hiếm khi dùng.
attachWebSocketServer(server as HttpServer);
// Subscriber permanent cho push notification (Phase 2 Bước 3) — chạy VÔ ĐIỀU KIỆN lúc boot, KHÔNG
// phụ thuộc có WebSocket connection nào (khác ConnectionRegistry's onFirstSubscriber/
// onLastUnsubscribe ở attachWebSocketServer trên): goal notification phải nổ kể cả khi không ai
// đang xem match qua WS. Xem apps/api/src/realtime/goal-notifier.ts.
startGoalNotifier();
// Cùng lý do/pattern startGoalNotifier() ở trên, kênh global riêng — xem
// apps/api/src/realtime/match-finished-notifier.ts.
startMatchFinishedNotifier();
