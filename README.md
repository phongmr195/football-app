# Football App

Monorepo cho Football Mobile App (Flutter + Hono + AWS). Xem kiến trúc đầy đủ và roadmap tại [docs/architecture/](docs/architecture/). Quy ước code + tech stack chi tiết: [CLAUDE.md](CLAUDE.md).

## Cấu trúc

- `apps/api` — Hono API (TypeScript)
- `apps/sync-worker` — đồng bộ dữ liệu từ data provider
- `apps/mobile` — Flutter app (Riverpod, GoRouter, Hive, Dio)
- `packages/database` — Prisma schema + client
- `packages/shared` — types/utils dùng chung
- `packages/data-provider` — adapter pattern cho data provider bóng đá (xem [data-provider-and-realtime-plan.md](docs/architecture/data-provider-and-realtime-plan.md))
- `packages/config` — eslint/tsconfig/prettier chung
- `infrastructure/terraform` — hạ tầng AWS (chưa apply, cần cấu hình credentials + `terraform.tfvars`)

## Bắt đầu (backend)

```bash
pnpm install
cp packages/database/.env.example packages/database/.env
cp apps/api/.env.example apps/api/.env
pnpm db:generate
pnpm dev
```

Kiểm tra nhanh: `curl http://localhost:3000/health`.

## apps/mobile

Đã scaffold sẵn (Flutter + Riverpod + GoRouter + Hive + Dio, xem `lib/features/health/` làm ví dụ pattern).

```bash
cd apps/mobile
flutter pub get
flutter analyze && flutter test
flutter run -d "iPhone 17"   # hoặc thiết bị/simulator khác đang có
```

**Lưu ý toolchain trên máy dev hiện tại** — nếu setup máy mới, xem chi tiết ở [CLAUDE.md § Mobile toolchain](CLAUDE.md#mobile-toolchain-máy-dev-hiện-tại):
- Cần `flutter config --no-enable-swift-package-manager` — Swift Package Manager từng gây treo build vô hạn, project đang dùng CocoaPods (Podfile commit vào git).
- Build Android cần `ANDROID_HOME` + `JAVA_HOME` set đúng (xem CLAUDE.md để lấy giá trị chính xác).

## Quy ước code & dùng Claude Code trong repo này

- [CLAUDE.md](CLAUDE.md) — tech stack, quy ước bắt buộc cho từng phần (API route, Prisma model, data-provider adapter, mobile feature).
- `.claude/agents/` — subagent chuyên biệt: `backend-dev`, `mobile-dev`.
- `.claude/skills/` — skill scaffold: `add-api-module`, `add-mobile-feature`, `add-prisma-model`.

## Git workflow

`main` và `develop` yêu cầu PR để merge (không push thẳng, không force-push/xoá branch). Làm việc trên feature branch, mở PR khi cần merge vào `develop`.
