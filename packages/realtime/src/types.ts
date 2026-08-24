// Shape publish-side của 1 lần cập nhật live-match — sync-worker publish, apps/api broadcast lại
// nguyên văn cho WS client (xem ws-server.ts trong apps/api). Bớt `lastEventSeq` so với
// PROJECT_PLAN gốc — chưa có event ingestion thật (Bước 1 xác nhận /matches/:id/events gần như
// luôn rỗng), thêm field cho thứ chưa tồn tại là dữ liệu chết.
export interface LiveUpdateEvent {
  matchId: string;
  // Cùng 6 giá trị với Prisma `MatchStatus` enum (packages/database/prisma/schema.prisma) —
  // không import trực tiếp từ @football-app/database để package này không phụ thuộc Prisma
  // client, chỉ cần giữ đúng union string.
  status: "SCHEDULED" | "LIVE" | "HALFTIME" | "FINISHED" | "POSTPONED" | "CANCELLED";
  minute: number | null;
  homeScore: number;
  awayScore: number;
  updatedAt: string; // ISO datetime
}

// Publish-side shape của 1 lần ghi bàn — dùng cho kênh global "goal-events" (Phase 2 Bước 3, khác
// với LiveUpdateEvent per-match ở trên: goal notification phải nổ kể cả khi KHÔNG ai đang xem qua
// WebSocket, xem plan Phase 2 Bước 3 § Context). `teamId` là ID nội bộ (Prisma `Team.id`, không
// phải externalRef) — apps/api reverse-lookup FavoriteTeam trực tiếp theo giá trị này.
export interface GoalEvent {
  matchId: string;
  teamId: string;
  homeScore: number;
  awayScore: number;
  scoredAt: string; // ISO datetime
}

// Publish-side shape khi 1 match VỪA chuyển sang FINISHED — kênh global riêng (giống GoalEvent),
// vì noti "trận đấu kết thúc" cũng phải nổ kể cả khi không ai đang xem qua WebSocket. Kèm sẵn tên
// đội (KHÔNG chỉ id) để apps/api's notifier dựng message push mà không cần query lại Postgres —
// sync-worker đã có sẵn data này ngay lúc publish (xem sync-live-matches.ts).
export interface MatchFinishedEvent {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  finishedAt: string; // ISO datetime
}
