# Football App

Monorepo cho Football Mobile App (Flutter + Hono + AWS). Xem kiến trúc đầy đủ và roadmap tại [docs/architecture/](docs/architecture/).

## Cấu trúc

- `apps/api` — Hono API (TypeScript)
- `apps/sync-worker` — đồng bộ dữ liệu từ data provider
- `apps/mobile` — Flutter app (chưa scaffold — cần cài Flutter SDK, xem ghi chú dưới)
- `packages/database` — Prisma schema + client
- `packages/shared` — types/utils dùng chung
- `packages/data-provider` — adapter pattern cho data provider bóng đá (xem [data-provider-and-realtime-plan.md](docs/architecture/data-provider-and-realtime-plan.md))
- `packages/config` — eslint/tsconfig/prettier chung
- `infrastructure/terraform` — hạ tầng AWS (chưa apply, cần cấu hình credentials + `terraform.tfvars`)

## Bắt đầu

```bash
pnpm install
cp packages/database/.env.example packages/database/.env
cp apps/api/.env.example apps/api/.env
pnpm db:generate
pnpm dev
```

## apps/mobile

Chưa scaffold vì máy dev hiện tại chưa có Flutter SDK. Khi cài Flutter, chạy:

```bash
cd apps
flutter create mobile
```

rồi wire lại theo tech stack trong [PROJECT_PLAN.md](docs/architecture/PROJECT_PLAN.md) (Riverpod, GoRouter, Hive, Dio).
