---
name: add-prisma-model
description: Thêm model/field mới vào packages/database/prisma/schema.prisma đúng convention của football-app (id, @@map, external_ref, relations), generate lại Prisma client. Dùng khi cần mở rộng database schema.
---

# Add Prisma Model

Thêm model mới hoặc sửa model có sẵn trong `packages/database/prisma/schema.prisma`, giữ đúng convention hiện có — KHÔNG tự sáng tạo convention khác cho model mới.

## Convention bắt buộc (xem các model có sẵn trong schema.prisma để đối chiếu)

- `id String @id @default(cuid())` — không dùng auto-increment Int trừ khi có lý do rõ ràng.
- Tên bảng snake_case qua `@@map("ten_bang")`, tên model PascalCase singular (`Team`, không phải `Teams`).
- Entity nào map với data provider bóng đá (team/player/match/competition) → thêm `externalRef Json?` để lưu `{ provider, id }`, xem `packages/data-provider/src/types.ts` (`ExternalRef`) — KHÔNG thêm cột `providerId` cứng riêng.
- Relation 1-n: FK field tên `<entity>Id String` + relation field cùng tên entity, có `onDelete: Cascade` khi con phụ thuộc hoàn toàn vào cha (ví dụ MatchEvent phụ thuộc Match).
- Bảng cần unique composite (ví dụ 1 user chỉ favorite 1 team 1 lần): `@@unique([fieldA, fieldB])`.
- Field JSON tự do cho dữ liệu chưa chuẩn hoá / dữ liệu thô từ provider: đặt tên `raw Json?`, không lẫn với các field đã typed.
- KHÔNG thêm bảng cho state ephemeral thay đổi liên tục (ví dụ connection tracking cho WebSocket) — loại đó dùng DynamoDB, xem `docs/architecture/data-provider-and-realtime-plan.md` § 2.4, không phải Prisma/Aurora.

## Bước thực hiện

1. Đọc `packages/database/prisma/schema.prisma`, tìm model gần nhất về mặt domain (cùng module: User/Competition/Team/Player/Match/Standing/AI/Notification) để đặt model mới đúng vị trí (dưới comment header `// ==== <Module> ====` tương ứng).
2. Viết model mới theo convention trên. Thêm relation ngược (`@relation`) ở cả 2 phía nếu là 1-n hoặc n-n — Prisma sẽ báo lỗi validation nếu thiếu 1 phía (lỗi hay gặp: "missing an opposite relation field").
3. Chạy `pnpm db:generate` — PHẢI pass không lỗi trước khi viết code dùng model mới.
4. Nếu có DB thật đang chạy: `pnpm db:migrate` để tạo migration (dev). Nếu chưa có DB (chưa apply Terraform), chỉ cần `db:generate` là đủ để code khác build/typecheck qua.
5. Cập nhật `docs/architecture/PROJECT_PLAN.md` § 4 nếu model mới không nằm trong danh sách đã liệt kê ở đó (giữ doc khớp với schema thật).
