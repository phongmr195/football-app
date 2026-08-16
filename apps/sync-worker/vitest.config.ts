import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test suite này chạy integration test against Postgres THẬT (Docker/local, xem CLAUDE.md §
    // Docker) — nhiều file test seed data trong cùng 1 DB, cleanup theo externalRef.provider
    // riêng của từng file (không phải transaction cô lập). computeNextInterval()
    // (adaptive-interval.ts) là 1 query CỐ Ý không filter theo provider (nó cần biết "có bất kỳ
    // match nào sắp/đang live trên toàn hệ thống", xem plan Phase 2 Bước 4) — nếu Vitest chạy
    // nhiều file test song song (mặc định fileParallelism: true), 1 file khác (vd
    // sync-live-matches.test.ts) có thể đang seed match LIVE tạm thời đúng lúc
    // adaptive-interval.test.ts assert "idle", gây flaky test do race điều kiện toàn cục. Tắt
    // fileParallelism để các file test chạy tuần tự — mỗi file tự cleanup xong (afterAll) trước
    // khi file kế tiếp chạy, loại bỏ race này. Đánh đổi: test suite chạy chậm hơn 1 chút, chấp
    // nhận được vì đây là integration test, không phải unit test cần chạy cực nhanh.
    fileParallelism: false,
  },
});
