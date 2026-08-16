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
