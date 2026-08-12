# Football App

Monorepo cho Football App (Web + Hono + AWS). Xem kiến trúc đầy đủ và roadmap tại [docs/architecture/](docs/architecture/). Quy ước code + tech stack chi tiết: [CLAUDE.md](CLAUDE.md).

> **Pivot (2026-08-07):** client chính chuyển từ Mobile (Flutter) sang **Web (Next.js)**. `apps/mobile` tạm pause — xem [ROADMAP.md § Mobile — tạm pause](docs/architecture/ROADMAP.md#mobile--tạm-pause-trạng-thái-tại-thời-điểm-pause).

## Cấu trúc

- `apps/web` — Next.js, client chính (chưa scaffold, xem ROADMAP Phase 1)
- `apps/mobile` — Flutter app (Riverpod, GoRouter, Hive, Dio, Firebase Auth) — **tạm pause**
- `apps/api` — Hono API (TypeScript)
- `apps/sync-worker` — đồng bộ dữ liệu từ data provider
- `packages/database` — Prisma schema + client
- `packages/shared` — types/utils dùng chung
- `packages/data-provider` — adapter pattern cho data provider bóng đá (chi tiết trong [PROJECT_PLAN.md § Data Provider](docs/architecture/PROJECT_PLAN.md))
- `packages/ui` — design system cho `apps/web` (chưa scaffold)
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

Kiểm tra nhanh: `curl http://localhost:3000/health`. Cần Postgres/Redis thật — dùng Docker (xem dưới) hoặc cài local, miễn khớp `DATABASE_URL` trong `.env`.

## Docker

Stack đầy đủ cho local dev: data (Postgres + Redis), log (Dozzle), test (Postgres riêng + test runner), deploy (Dockerfile production cho `apps/api`/`apps/sync-worker`).

```bash
pnpm docker:up       # postgres + redis + dozzle + api (build từ apps/api/Dockerfile)
pnpm db:migrate      # chạy migration vào postgres trong docker (từ máy host, DATABASE_URL trỏ localhost:5432)
pnpm docker:logs     # mở Dozzle (http://localhost:8080) — xem log tất cả container
pnpm docker:worker   # chạy sync-worker 1 lượt rồi exit (profile "worker", không tự chạy cùng docker:up)
pnpm docker:down     # dừng + xoá container (giữ volume data)
```

Chạy test suite cô lập (Postgres riêng, ephemeral, không đụng data dev):

```bash
pnpm docker:test
```

Build image production thật (dùng khi deploy lên ECR/ECS — chưa wire vào CI, xem ROADMAP):

```bash
docker build -f apps/api/Dockerfile -t football-app-api .
docker build -f apps/sync-worker/Dockerfile -t football-app-sync-worker .
```

## apps/web

Chưa scaffold — client chính hiện tại, xem [ROADMAP.md Phase 1](docs/architecture/ROADMAP.md) để biết việc cần làm (Next.js + `packages/ui` + Firebase Auth cho web).

## apps/mobile (tạm pause)

Đã scaffold sẵn (Flutter + Riverpod + GoRouter + Hive + Dio + Firebase Auth, xem `lib/features/health/` và `lib/features/auth/` làm ví dụ pattern). Không phát triển tiếp lúc này — xem lý do pivot ở trên. Vẫn có thể chạy để tham khảo/resume sau:

```bash
cd apps/mobile
flutterfire configure -p jankara-e2e-test --platforms=ios,android -y  # sinh google-services.json/GoogleService-Info.plist/firebase_options.dart (gitignored, xem CLAUDE.md § Authentication)
flutter pub get
flutter analyze && flutter test
flutter run -d "iPhone 17"   # hoặc thiết bị/simulator khác đang có
```

**Lưu ý toolchain trên máy dev hiện tại** — nếu setup máy mới, xem chi tiết ở [CLAUDE.md § Mobile toolchain](CLAUDE.md#mobile-toolchain-máy-dev-hiện-tại-cần-khi-resume-mobile):
- Cần `flutter config --no-enable-swift-package-manager` — Swift Package Manager từng gây treo build vô hạn, project đang dùng CocoaPods (Podfile commit vào git).
- Build Android cần `ANDROID_HOME` + `JAVA_HOME` set đúng (xem CLAUDE.md để lấy giá trị chính xác).
- Google Sign-In trên iOS cần `GIDClientID` + URL scheme trong `Info.plist` — không tự sinh bởi `flutterfire configure` (xem CLAUDE.md § Authentication).

## Quy ước code & dùng Claude Code trong repo này

- [CLAUDE.md](CLAUDE.md) — tech stack, quy ước bắt buộc cho từng phần (API route, Prisma model, data-provider adapter, web/mobile feature).
- `.claude/agents/` — subagent chuyên biệt: `backend-dev`, `web-dev`, `mobile-dev` (mobile tạm pause).
- `.claude/skills/` — skill scaffold: `add-api-module`, `add-web-page`, `add-mobile-feature`, `add-prisma-model`.

## Git workflow

`main` và `develop` yêu cầu PR để merge (không push thẳng, không force-push/xoá branch). Làm việc trên feature branch, mở PR khi cần merge vào `develop`.
