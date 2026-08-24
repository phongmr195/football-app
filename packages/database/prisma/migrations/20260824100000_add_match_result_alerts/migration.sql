-- Bật/tắt riêng cho push noti "kết quả trận đấu" (match FINISHED) — tách khỏi goalAlerts (mỗi
-- bàn thắng) vì user có thể chỉ muốn biết kết quả cuối, không cần noti từng bàn. Xem
-- apps/api/src/realtime/match-finished-notifier.ts.
ALTER TABLE "notification_settings" ADD COLUMN "matchResultAlerts" BOOLEAN NOT NULL DEFAULT true;
