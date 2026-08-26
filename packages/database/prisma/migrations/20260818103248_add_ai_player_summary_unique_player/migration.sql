-- Viết tay (không phải expression index) — chỉ vì `prisma migrate dev` từ chối chạy non-
-- interactive khi phát hiện thay đổi có thể phá (unique constraint mới có thể fail nếu có dữ liệu
-- trùng). Đã verify thật (2026-08-18): bảng ai_player_summary đang rỗng (0 dòng), an toàn 100%.
-- Xem CLAUDE.md § Database cho lý do prisma migrate deploy dùng ở đây thay vì migrate dev.
CREATE UNIQUE INDEX "ai_player_summary_playerId_key" ON "ai_player_summary"("playerId");
