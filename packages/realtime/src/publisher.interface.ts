import type { GoalEvent, LiveUpdateEvent } from "./types";

// Interface CHỈ áp dụng cho phía publish (mirror DataProviderAdapter — sync-worker phụ thuộc vào
// interface này, không biết transport cụ thể là Redis Pub/Sub hay (sau này) AWS SNS/EventBridge).
//
// Phía SERVE/SUBSCRIBE (nhận message từ transport rồi push xuống WebSocket client) CỐ Ý không nằm
// trong package này — đó là code cụ thể của apps/api (connection registry, WS server wiring theo
// HTTP server object), và AWS Lambda không có khái niệm "server object"/in-memory registry tương
// đương nên ép nó vào 1 interface chung sẽ là abstraction giả tạo, không thật sự swap được giữa
// local và AWS. Xem plan Phase 2 Bước 2 § Context để biết lý do quyết định này.
export interface RealtimeTransport {
  readonly transportName: string;
  publish(event: LiveUpdateEvent): Promise<void>;
  // Kênh global riêng ("goal-events", xem RedisPublisher) — KHÔNG dùng chung interface/method với
  // publish() vì subscriber phía apps/api khác hẳn (permanent goal-notifier vs per-match
  // ConnectionRegistry). Vẫn cùng 1 transport/connection Redis, chỉ thêm method thứ 2 — xem plan
  // Phase 2 Bước 3 § A3 cho lý do không tách interface riêng.
  publishGoal(event: GoalEvent): Promise<void>;
}
