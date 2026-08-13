# Football App

Monorepo cho Football App (Web + Hono + AWS). Xem kiến trúc đầy đủ và roadmap tại [docs/architecture/](docs/architecture/). Quy ước code + tech stack chi tiết: [CLAUDE.md](CLAUDE.md).

> **Pivot (2026-08-07):** client chính chuyển từ Mobile (Flutter) sang **Web (Next.js)**. `apps/mobile` tạm pause — xem [ROADMAP.md § Mobile — tạm pause](docs/architecture/ROADMAP.md#mobile--tạm-pause-trạng-thái-tại-thời-điểm-pause).

## Cấu trúc

- `apps/web` — Next.js, client chính (browse giải đấu/bảng xếp hạng/lịch thi đấu/team/player + Firebase Auth + favorites, xem "## apps/web" dưới)
- `apps/mobile` — Flutter app (Riverpod, GoRouter, Hive, Dio, Firebase Auth) — **tạm pause**
- `apps/api` — Hono API (TypeScript)
- `apps/sync-worker` — đồng bộ dữ liệu từ data provider
- `packages/database` — Prisma schema + client
- `packages/shared` — types/utils dùng chung
- `packages/data-provider` — adapter pattern cho data provider bóng đá (chi tiết trong [PROJECT_PLAN.md § Data Provider](docs/architecture/PROJECT_PLAN.md))
- `packages/ui` — design system cho `apps/web` (Button/Card/Badge/Container)
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

Stack đầy đủ cho local dev: data (Postgres + Redis), log (Dozzle), auth (Firebase Auth Emulator), test (Postgres riêng + test runner), deploy (Dockerfile production cho `apps/api`/`apps/sync-worker`).

```bash
cp .env.example .env   # optional — chỉ cần khi muốn set API_FOOTBALL_KEY hoặc verify Firebase project thật
pnpm docker:up       # postgres + redis + dozzle + firebase-emulator + api
pnpm db:migrate      # chạy migration vào postgres trong docker (từ máy host, DATABASE_URL trỏ localhost:5432)
pnpm docker:logs     # mở Dozzle (http://localhost:8080) — xem log tất cả container
pnpm docker:auth-ui  # mở Firebase Emulator UI (http://localhost:4000) — xem/tạo test user
pnpm docker:worker   # chạy sync-worker 1 lượt rồi exit (profile "worker", không tự chạy cùng docker:up)
pnpm docker:down     # dừng + xoá container (giữ volume data)
```

`api` khi chạy qua Docker tự dùng Firebase Auth Emulator (project giả `demo-football-app`) để verify token — không cần Firebase project thật để test đăng nhập local.

**Lưu ý:** nếu máy có Postgres native khác (ví dụ Postgres.app) đang chạy, nó có thể chiếm port 5432 và khiến lệnh chạy từ host (như `pnpm db:migrate`) vào nhầm DB đó thay vì Docker — tắt Postgres native nếu không dùng, hoặc `lsof -i :5432` kiểm tra trước khi debug.

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

Client chính (Next.js App Router). Cần `apps/api` + Postgres + Firebase Auth Emulator đang chạy trước (xem "## Docker" ở trên) — các trang browse gọi thẳng `apps/api`, và đăng nhập dùng Firebase Auth Emulator ở local.

```bash
pnpm docker:up                          # postgres + firebase-emulator + api (cần cho web gọi vào)
cp apps/web/.env.example apps/web/.env.local
```

Điền `NEXT_PUBLIC_FIREBASE_*` trong `apps/web/.env.local` bằng config Web app thật (đã đăng ký sẵn trong project `jankara-e2e-test`, xem [CLAUDE.md § Authentication](CLAUDE.md#authentication-firebase-auth)):

```bash
firebase apps:list --project jankara-e2e-test              # lấy app id (platform WEB)
firebase apps:sdkconfig WEB <app-id> --project jankara-e2e-test
```

`API_URL`/`NEXT_PUBLIC_API_URL` trong `.env.example` đã sẵn `http://localhost:3000` (khớp port `apps/api` expose qua Docker) — không cần đổi cho local dev.

```bash
pnpm --filter @football-app/web dev     # hoặc pnpm dev để chạy tất cả app qua turbo
```

Mở trình duyệt theo URL Next.js in ra — thường là `http://localhost:3001` (không phải `3000`, vì port đó đã bị `apps/api` chiếm khi chạy qua Docker cùng lúc). Các trang chính: `/competitions`, `/matches`, `/standings/[seasonId]`, `/teams/[id]`, `/players/[id]`, `/auth` (đăng nhập Google/Phone), `/favorites`.

**Lưu ý:** banner đỏ "Running in emulator mode..." ở đáy trang khi đăng nhập là do chính Firebase SDK hiển thị lúc nối Auth Emulator — bình thường, chỉ xuất hiện ở dev local, không phải lỗi.

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
