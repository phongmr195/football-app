# Football App — CLAUDE.md

Monorepo cho Football App. Kiến trúc đầy đủ + roadmap: [docs/architecture/PROJECT_PLAN.md](docs/architecture/PROJECT_PLAN.md), [docs/architecture/ROADMAP.md](docs/architecture/ROADMAP.md).

> **Pivot (2026-08-07):** client chính chuyển từ Mobile (Flutter) sang **Web (Next.js)**. `apps/mobile` tạm pause — code giữ nguyên, quy ước Mobile dưới đây vẫn đúng, chỉ không phải track đang active. Xem lý do ở [PROJECT_PLAN.md § 1 Pivot](docs/architecture/PROJECT_PLAN.md#pivot-web-trước-mobile-tạm-pause-2026-08-07).

## Tech stack

- **Web** (client chính): Next.js (React), Firebase Authentication (Google/Phone) qua Firebase JS SDK — chưa scaffold, xem ROADMAP Phase 1
- **Mobile** (tạm pause): Flutter, Riverpod, GoRouter, Hive, Dio — đã có Phase 0 + auth, xem [ROADMAP.md § Mobile — tạm pause](docs/architecture/ROADMAP.md#mobile--tạm-pause-trạng-thái-tại-thời-điểm-pause)
- **Auth**: Firebase Authentication (Google + Phone đã enable, Facebook chưa) — đổi từ AWS Cognito, xem [PROJECT_PLAN.md § Authentication](docs/architecture/PROJECT_PLAN.md#authentication--quyết-định-đổi-từ-cognito-sang-firebase-auth-2026-08-06). Firebase project hiện dùng: `jankara-e2e-test` (project dùng chung, không riêng cho football-app).
- **Backend**: Node.js, Hono, TypeScript, Zod (`@hono/zod-validator`), Prisma, `firebase-admin` (verify token)
- **Database**: Aurora PostgreSQL (Prisma), Redis (cache — chưa setup), Postgres FTS/pgvector cho search/AI (xem PROJECT_PLAN.md § 7.1 — hoãn OpenSearch tới khi cần)
- **AI**: Amazon Bedrock (Claude, Titan embedding) — chưa implement, xem ROADMAP Phase 4
- **Data provider**: API-Football qua adapter pattern (`packages/data-provider`)
- **Infra**: Terraform (`infrastructure/terraform`, chưa apply), Turborepo + pnpm workspaces
- **Secret scanning**: `secretlint` qua Husky pre-commit + CI backstop — xem "### Secrets & credentials"
- **Docker**: `docker-compose.yml` (data: Postgres+Redis, log: Dozzle, auth: Firebase Auth Emulator, app: api+sync-worker) cho local dev; `docker-compose.test.yml` cho test cô lập; `apps/api/Dockerfile` + `apps/sync-worker/Dockerfile` multi-stage production-ready (dùng `pnpm deploy`)

## Cấu trúc monorepo

```
apps/
  web/            Next.js — client chính (chưa scaffold)
  mobile/         Flutter app — TẠM PAUSE, giữ code
  api/            Hono API (TypeScript)
  sync-worker/    Đồng bộ dữ liệu từ data provider
packages/
  database/       Prisma schema + client (export từ packages/database/src/index.ts)
  shared/         Types/utils dùng chung TS (pagination, ApiError)
  data-provider/  Canonical model + adapter pattern cho data provider bóng đá
  ui/             Design system — dùng cho apps/web (chưa scaffold)
  config/         eslint/tsconfig/prettier chung
```

## Lệnh hay dùng

```bash
pnpm install
pnpm db:generate        # generate Prisma client sau khi sửa schema.prisma
pnpm dev                # chạy tất cả apps qua turbo
pnpm --filter @football-app/api dev
pnpm lint / typecheck / build / test    # chạy toàn monorepo qua turbo
```

```bash
# Mobile (tạm pause — lệnh dưới vẫn đúng khi resume)
cd apps/mobile
flutter analyze && flutter test
flutter run -d "iPhone 17"    # cần ANDROID_HOME/JAVA_HOME nếu build Android, xem "Mobile toolchain" dưới
```

```bash
# Docker (data/log/test/deploy) — xem "### Docker" dưới để biết convention
cp .env.example .env  # optional — chỉ cần nếu muốn set API_FOOTBALL_KEY/FIREBASE_PROJECT_ID thật
pnpm docker:up      # postgres + redis + dozzle + firebase-emulator + api
pnpm docker:worker  # sync-worker 1 lượt (profile "worker", không tự chạy cùng docker:up)
pnpm docker:test    # test suite trong container, Postgres riêng ephemeral
pnpm docker:down
```

## Quy ước bắt buộc theo (đọc kỹ trước khi thêm code mới)

### Secrets & credentials (đọc trước khi commit bất cứ file config/credential nào)
- **3 lớp bảo vệ, không lớp nào tự đủ — đừng bỏ qua lớp nào vì tưởng lớp khác đã lo:**
  1. `.gitignore` — chặn file generated-credential đã biết (`google-services.json`, `GoogleService-Info.plist`, `lib/firebase_options.dart`) khỏi bị `git add` thông thường bắt vào. Thêm file loại này (service account key, cert, token khác) → thêm vào `.gitignore` NGAY khi tạo ra, không chờ.
  2. **Husky pre-commit** (`.husky/pre-commit` → `lint-staged` → `.lintstagedrc.json`) chạy 2 check trên file staged: `secretlint` (nội dung — bắt AWS key, private key, Slack/Stripe token...) + `scripts/block-credential-files.sh` (tên file — chặn cả khi bị `git add -f` ép qua gitignore).
  3. CI job `secretlint` (`.github/workflows/ci.yml`) chạy `pnpm secretlint` trên toàn repo — backstop nếu ai đó `git commit --no-verify` bỏ qua hook local.
- **secretlint KHÔNG bắt được Firebase/Google client API key (`AIzaSy...`)** — đây là chủ đích của tool (Google thiết kế key này an toàn để public, xem [PROJECT_PLAN.md § Authentication]). Vì vậy lớp #1 (gitignore theo tên file) và #2b (block theo tên file) là lớp bảo vệ THẬT cho loại file này, không phải secretlint. Đừng tưởng "đã có secretlint" là đủ khi thêm file Firebase config mới.
- Test hook hoạt động: `git add -f <file>` rồi `git commit` — phải bị chặn với message rõ ràng. Đã verify thật (2026-08-12) với đúng file Firebase từng leak.
- Cần bypass hợp lệ (hiếm, ví dụ file `.example` bị false-positive) → sửa `.lintstagedrc.json`/`.secretlintrc.json` thêm exception, KHÔNG dùng `git commit --no-verify` trừ khi đã hỏi user trước.
- `pnpm secretlint` chạy check thủ công toàn repo bất kỳ lúc nào (không cần staged).

### Backend (`apps/api`)
- Route mới → 1 file trong `apps/api/src/routes/<module>.ts`, export 1 `Hono` instance, mount vào `app.ts` qua `app.route(...)`.
- Validate input bằng `@hono/zod-validator` (`zValidator("json"|"query"|"param", schema)`), KHÔNG parse tay bằng `schema.parse()` trong handler.
- Cần auth → thêm middleware `requireAuth` (từ `src/middleware/auth.ts`) vào route đó, đọc `userId` qua `c.get("userId")`.
- Đọc/ghi DB qua `prisma` import từ `@football-app/database` — không tạo `PrismaClient` mới trong route.
- Dùng skill `add-api-module` để scaffold module mới theo đúng pattern trên.
- Middleware auth dùng chung cho MỌI client (web, mobile) — không có logic riêng theo client.

### Database (`packages/database`)
- Model mới trong `schema.prisma`: id dùng `String @id @default(cuid())`, tên bảng snake_case qua `@@map("...")`, thêm `external_ref Json?` nếu entity map với data provider.
- Sau khi sửa schema: `pnpm db:generate`, rồi migration khi có DB thật (`pnpm db:migrate`).
- Dùng skill `add-prisma-model` khi thêm model mới.

### Data provider (`packages/data-provider`)
- KHÔNG để downstream code (sync-worker, api) biết hình dạng JSON thật của provider — luôn map qua canonical model trong `src/types.ts` trước.
- Provider mới → thêm adapter trong `src/adapters/`, implement `DataProviderAdapter` interface, KHÔNG sửa canonical model để khớp provider mới (ngược lại).

### Docker
- `docker-compose.yml` (root) = data/log/auth/app cho local dev: `postgres`, `redis`, `dozzle` (log viewer, http://localhost:8080), `firebase-emulator` (Auth Emulator, project giả `demo-football-app` — KHÔNG đụng project thật `jankara-e2e-test`; API :9099, UI :4000), `api`, `sync-worker` (profile `worker`, không tự chạy). Tất cả service dài hạn có `restart: unless-stopped`; `postgres`/`redis`/`firebase-emulator`/`api` có HEALTHCHECK, `api` depends_on cả 3 với `condition: service_healthy`.
- `api` mặc định trỏ `FIREBASE_AUTH_EMULATOR_HOST=firebase-emulator:9099` khi chạy qua `docker compose` — test đăng nhập/verify token KHÔNG cần Firebase project thật. Override qua `.env` (copy từ `.env.example`) nếu muốn verify token thật từ `jankara-e2e-test`.
- `docker-compose.test.yml` = test cô lập: `postgres-test` riêng (tmpfs, ephemeral) + `test-runner` build từ `Dockerfile.test` (KHÔNG dùng `apps/*/Dockerfile` cho test vì file đó đã prune xuống 1 app + prod deps qua `pnpm deploy`, không đủ để chạy toàn bộ test suite monorepo).
- `apps/api/Dockerfile`, `apps/sync-worker/Dockerfile` = production image, dùng `pnpm --filter=<pkg> --prod deploy --legacy /deploy/<name>` (pnpm v10 cần `--legacy` nếu không set `inject-workspace-packages=true`) để tách app + deps thật ra khỏi monorepo (không symlink) — pattern chuẩn của pnpm cho Docker. Có `RUN --mount=type=cache,target=/root/.local/share/pnpm/store` ở bước `pnpm install` để build sau nhanh hơn.
- Thêm app/package mới cần Dockerfile riêng → copy đúng pattern 2 file trên (base alpine + libc6-compat/openssl cho Prisma, build stage chạy `db:generate` + `turbo run build --filter=<pkg>...` + `pnpm deploy --legacy`, runtime stage chỉ copy `/deploy/<name>`).
- Postgres trong Docker dùng đúng port/user/pass khớp `packages/database/.env.example` (`postgres:postgres@localhost:5432/football_app`) — sửa 1 chỗ phải sửa chỗ kia theo, đừng để lệch.
- **Cảnh báo máy dev cụ thể**: nếu có Postgres.app (hoặc bất kỳ Postgres native nào) đang chạy trên máy, nó chiếm port 5432 và **âm thầm nhận hết traffic từ host tới `localhost:5432`** thay vì Docker container (bind cụ thể `127.0.0.1` được ưu tiên hơn bind wildcard `0.0.0.0` của Docker) — lệnh `prisma migrate`/`psql` chạy từ host tưởng đang nói với Docker Postgres nhưng thực ra vào native Postgres. Luôn `lsof -i :5432` kiểm tra trước khi debug "sao không thấy data" liên quan Docker Postgres.

### Web (`apps/web`) — client chính, chưa scaffold
- Khi scaffold: Next.js + `packages/ui`, gọi `apps/api` trực tiếp (REST), Firebase JS SDK cho auth (đăng ký Web app riêng trong Firebase project `jankara-e2e-test` trước).
- Trang public (browse giải đấu/team/match) nên dùng SSR/ISR cho SEO — đây là lý do chính chọn Next.js thay vì Flutter Web.
- Dùng skill `add-web-page` để scaffold page/feature mới (khi có).

### Mobile (`apps/mobile`) — tạm pause, quy ước vẫn giữ cho khi resume
- Feature mới → folder riêng trong `lib/features/<feature>/` (theo mẫu `lib/features/health/`), gồm 1 Riverpod provider gọi qua `dioProvider` + 1 screen.
- Gọi API qua `dioProvider` (`lib/core/network/dio_client.dart`), không tạo `Dio()` instance riêng lẻ trong widget.
- Route mới → thêm vào `lib/core/router/app_router.dart` (GoRouter), không dùng `Navigator.push` trực tiếp trừ dialog/bottom sheet cục bộ.
- Dùng skill `add-mobile-feature` để scaffold feature mới.

### Authentication (Firebase Auth)
- Mobile: `lib/features/auth/auth_provider.dart` (`AuthController` — Google + Phone) và `auth_screen.dart`, đã wire vào router (`/auth`), có nút "Đăng nhập" ở `HealthScreen`. **Đã verify**: mở được màn Google sign-in thật trên iOS Simulator.
- iOS cần thêm `GIDClientID` + URL scheme (`CFBundleURLTypes`) vào `ios/Runner/Info.plist` — **`flutterfire configure` KHÔNG tự làm bước này**, phải lấy `CLIENT_ID`/`REVERSED_CLIENT_ID` từ `GoogleService-Info.plist` rồi thêm tay. Nếu thiếu, lỗi runtime: `PlatformException(google_sign_in, No active configuration...)`.
- Nếu enable thêm provider (Facebook, v.v.) trong Firebase Console SAU KHI đã chạy `flutterfire configure` lần đầu → phải chạy lại `flutterfire configure` để tải `GoogleService-Info.plist`/`google-services.json` mới (file cũ thiếu `CLIENT_ID` cho provider mới enable).
- Web: đăng ký Web app riêng trong Firebase Console (project `jankara-e2e-test`), dùng Firebase JS SDK — chưa làm, xem ROADMAP Phase 1.
- Backend verify token qua `requireAuth` middleware (`apps/api/src/middleware/auth.ts`) dùng `firebase-admin` — chạy qua `pnpm docker:up` đã tự set `FIREBASE_AUTH_EMULATOR_HOST=firebase-emulator:9099` (xem "### Docker"), không cần project thật để test local; set `FIREBASE_PROJECT_ID`/`FIREBASE_SERVICE_ACCOUNT` trong `.env` khi cần verify token thật từ `jankara-e2e-test`. Dùng chung cho web + mobile.
- Facebook login: chưa thêm (cần tạo Facebook App trước tại developers.facebook.com), thêm khi có nhu cầu thật.
- `firebase-tools` CLI (đã cài global) dùng cho `flutterfire configure`/`firebase emulators:start`/`firebase login`.
- `google-services.json`, `GoogleService-Info.plist`, `lib/firebase_options.dart` **đã gitignore** (2026-08-07, sau khi bị secret scanner flag do repo public) — không phải secret nhạy cảm kiểu AWS key (Firebase client API key an toàn để public theo thiết kế của Google), nhưng project `jankara-e2e-test` dùng chung với app khác nên không commit. Máy mới clone repo phải tự chạy `flutterfire configure -p jankara-e2e-test --platforms=ios,android -y` trong `apps/mobile` để sinh lại 3 file này trước khi build.

## Mobile toolchain (máy dev hiện tại — cần khi resume mobile)

Đã cài đủ Flutter + Android SDK + Xcode + CocoaPods. Lưu ý quan trọng:
- **SPM đã bị tắt** (`flutter config --no-enable-swift-package-manager`) — project dùng CocoaPods (Podfile commit vào git), vì Swift Package Manager từng gây treo vô hạn khi build lần đầu trên máy này. KHÔNG bật lại SPM trừ khi verify kỹ không bị treo.
- iOS deployment target đã nâng lên **15.0** (`Podfile` + `project.pbxproj`) — `firebase_auth` yêu cầu tối thiểu 15.0, không hạ xuống lại.
- Cần set `ANDROID_HOME=/usr/local/share/android-commandlinetools` và `JAVA_HOME=/usr/local/opt/openjdk@17` khi build Android (đã có trong `~/.zshrc`, nhưng Bash tool không tự load — export lại nếu cần trong session mới).
- Máy có RVM (Ruby version manager) làm ruby mặc định; CocoaPods được cài qua `gem install cocoapods` dưới RVM ruby (không phải qua brew) để tránh xung đột gem path.
- Simulator + Android Studio chạy cùng lúc có thể làm máy quá tải nặng (load average tăng vọt, process "stuck") — nếu gặp lệnh bash bị treo bất thường, kiểm tra `uptime`/`top -l 1` trước khi nghi ngờ code; tắt Simulator (`killall Simulator`) thường đủ để hồi phục, không cần restart máy.

## Git / branch protection

- `main` và `develop` yêu cầu PR để merge (không cho push thẳng, không cho force-push/xoá branch).
- Nhánh feature không bị giới hạn — push thẳng lên feature branch bình thường, mở PR khi cần merge vào `develop`.
