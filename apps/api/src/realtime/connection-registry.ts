// Shape tối thiểu cần cho registry — KHÔNG import trực tiếp type `WebSocket` từ package "ws" ở
// đây để class này độc lập test được bằng object giả ({ readyState, send: vi.fn() }), không phụ
// thuộc runtime thật của "ws". `ws.WebSocket` thật thoả structural typing này (readyState: number,
// send(data): void), nên vẫn dùng được nguyên vẹn từ ws-server.ts.
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
}

export interface ConnectionRegistryOptions {
  // Trigger đúng lúc 1 matchId chuyển từ 0 -> 1 subscriber (cần mở Redis subscribe cho kênh
  // live:match:<matchId>) và 1 -> 0 subscriber (đóng lại, tránh leak subscription vô ích).
  onFirstSubscriber(matchId: string): void;
  onLastUnsubscribe(matchId: string): void;
}

// ConnectionRegistry thuần — không phụ thuộc Hono hay "ws" server cụ thể, chỉ quản lý 2 map 2
// chiều (matchId -> sockets, socket -> matchIds) để O(1) subscribe/unsubscribe/cleanup và biết
// chính xác khi nào 1 matchId không còn ai theo dõi.
export class ConnectionRegistry {
  private readonly matchToSockets = new Map<string, Set<WebSocketLike>>();
  private readonly socketToMatches = new Map<WebSocketLike, Set<string>>();

  constructor(private readonly options: ConnectionRegistryOptions) {}

  subscribe(matchId: string, ws: WebSocketLike): void {
    let sockets = this.matchToSockets.get(matchId);
    if (!sockets) {
      sockets = new Set();
      this.matchToSockets.set(matchId, sockets);
    }
    const isFirstSubscriber = sockets.size === 0;
    sockets.add(ws);

    let matches = this.socketToMatches.get(ws);
    if (!matches) {
      matches = new Set();
      this.socketToMatches.set(ws, matches);
    }
    matches.add(matchId);

    if (isFirstSubscriber) {
      this.options.onFirstSubscriber(matchId);
    }
  }

  unsubscribe(matchId: string, ws: WebSocketLike): void {
    const sockets = this.matchToSockets.get(matchId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.matchToSockets.delete(matchId);
        this.options.onLastUnsubscribe(matchId);
      }
    }

    const matches = this.socketToMatches.get(ws);
    if (matches) {
      matches.delete(matchId);
      if (matches.size === 0) {
        this.socketToMatches.delete(ws);
      }
    }
  }

  // Dọn hết 1 socket đã đóng/lỗi khỏi MỌI matchId nó từng subscribe — gọi trên sự kiện "close"/
  // "error" của WS connection (xem ws-server.ts). Tái dùng unsubscribe() cho từng matchId để logic
  // trigger onLastUnsubscribe nhất quán, không lặp lại.
  cleanupSocket(ws: WebSocketLike): void {
    const matches = this.socketToMatches.get(ws);
    if (!matches) return;

    // Copy ra mảng trước khi lặp — unsubscribe() sẽ mutate `matches` (chính là Set đang lặp) nếu
    // lặp trực tiếp trên nó.
    for (const matchId of [...matches]) {
      this.unsubscribe(matchId, ws);
    }
  }

  // Dùng trong ws-server.ts để lấy tất cả socket đang subscribe 1 matchId khi cần broadcast.
  getSubscribers(matchId: string): ReadonlySet<WebSocketLike> {
    return this.matchToSockets.get(matchId) ?? new Set();
  }
}
