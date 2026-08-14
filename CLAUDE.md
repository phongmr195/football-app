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
- **Data provider**: `football-data.org` (mặc định) qua adapter pattern (`packages/data-provider`) — API-Football vẫn giữ làm adapter phụ, đổi default vì API-Football free tier bị suspend nhiều lần, xem "### Data provider" dưới
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
- Model mới trong `schema.prisma`: id dùng `String @id @default(cuid())`, tên bảng snake_case qua `@@map("...")`, thêm `externalRef Json?` (field name camelCase, KHÔNG `@map` — cột DB thật cũng là `"externalRef"` camelCase, xem migration init) nếu entity map với data provider. Shape bắt buộc `{ provider: string, id: string }` (`ExternalRef` trong `packages/data-provider/src/types.ts`).
- **Model có `externalRef Json?` BẮT BUỘC đi kèm 1 unique expression index** trên `(externalRef->>'provider', externalRef->>'id')`, partial `WHERE "externalRef" IS NOT NULL` — lý do: 2 provider khác nhau (vd `api-football` id "39" vs `football-data` id "39") có thể trùng id số dù là 2 entity thật khác nhau; nếu code chỉ lookup theo `id` mà quên `provider`, `findFirst` có thể match nhầm row và silently overwrite data (bug thật tìm thấy 2026-08-14 ở `apps/sync-worker/src/sync-catalog.ts`, xem migration `20260814000000_add_external_ref_provider_id_unique_index`). Index này là **expression/functional index — không biểu diễn được trong Prisma schema DSL** (Prisma không có cú pháp cho index trên biểu thức JSON), nên phải viết migration tay theo style `packages/database/prisma/migrations/20260813000000_rename_cognito_sub_to_firebase_uid/migration.sql` (SQL thuần + comment giải thích), KHÔNG hiện trong `schema.prisma`/`prisma db pull`. Mẫu SQL (đổi tên bảng/index cho đúng model mới):
  ```sql
  CREATE UNIQUE INDEX "<table>_external_ref_provider_id_key"
    ON "<table>" (("externalRef"->>'provider'), ("externalRef"->>'id'))
    WHERE "externalRef" IS NOT NULL;
  ```
  Dùng B-tree (mặc định), KHÔNG dùng GIN — đây là exact-match lookup, không phải containment query.
- **Lookup theo `externalRef` LUÔN LUÔN filter cả `provider` VÀ `id`, KHÔNG BAO GIỜ filter chỉ `id`** — đây chính là bug đã tìm thấy ở trên. Prisma JSON "AND 2 path điều kiện":
  ```ts
  prisma.<model>.findFirst({
    where: {
      AND: [
        { externalRef: { path: ["provider"], equals: provider } },
        { externalRef: { path: ["id"], equals: externalId } },
      ],
    },
  })
  ```
  Hàm lookup nên nhận `provider` qua tham số (lấy từ `adapter.providerName`, xem `DataProviderAdapter`), không đọc từ global.
- Sau khi sửa schema: `pnpm db:generate`, rồi migration khi có DB thật (`pnpm db:migrate`).
- Dùng skill `add-prisma-model` khi thêm model mới.
- Sửa tay data sai từ provider (Phase 1, chưa có `apps/admin`) → `pnpm db:studio` (Prisma Studio, đã verify chạy thật) — không viết tool riêng trừ khi Prisma Studio thật sự không đủ.

### Data provider (`packages/data-provider`)
- KHÔNG để downstream code (sync-worker, api) biết hình dạng JSON thật của provider — luôn map qua canonical model trong `src/types.ts` trước.
- Provider mới → thêm adapter trong `src/adapters/`, implement `DataProviderAdapter` interface, KHÔNG sửa canonical model để khớp provider mới (ngược lại).
- **Provider mặc định (2026-08-13): `football-data.org`** (`FootballDataAdapter`), KHÔNG phải API-Football — API-Football free tier bị **suspend account thật 3 lần** (3 key khác nhau) và quota 100 request/ngày quá chật. `football-data.org` free tier ("Free Forever", verify thật): **10 request/phút, KHÔNG có giới hạn/ngày**, phủ 13 giải lớn (Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, Eredivisie, Primeira Liga, Championship, Brasileirão, Copa Libertadores, World Cup, European Championship) — đủ scope MVP. `ApiFootballAdapter` vẫn giữ nguyên, tested, không bị xoá — chỉ không còn là default.
- `apps/sync-worker` chọn adapter qua `createAdapter()` (`apps/sync-worker/src/provider.ts`), đọc env `DATA_PROVIDER` (`"football-data"` mặc định | `"api-football"`). Set `FOOTBALL_DATA_API_KEY`/`API_FOOTBALL_KEY` tương ứng.
- Mỗi adapter tự throttle qua `rate-limiter.ts` (sliding-window, injectable clock) — margin an toàn dưới giới hạn thật của provider, KHÔNG sát biên: `ApiFootballAdapter` 8 req/phút (giới hạn cứng 10/phút VÀ 100/ngày), `FootballDataAdapter` 8 req/phút (giới hạn cứng 10/phút, KHÔNG giới hạn/ngày). Adapter mới cho provider khác PHẢI tự cân nhắc rate limit tương tự, không giả định provider không giới hạn.
- API-Football Free plan: full sync 1 giải ~20 team tốn ~70-80 request (phân trang squad) — chỉ đủ ngân sách ~1 giải/ngày. football-data.org không có giới hạn ngày nên không bị ràng buộc này, nhưng vẫn chỉ 10 req/phút — full sync 1 giải/season (~26 request: competitions+seasons+teams×2+players×20 team+standings+matches) mất vài phút do rate limiter, đừng chạy đồng thời nhiều `SYNC_COMPETITION_IDS` nếu cần nhanh.
- `FootballDataAdapter.fetchPlayers` bắt riêng lỗi HTTP 403 từ `GET /teams/{id}` — provider gate quyền truy cập theo giải team đang đá **hiện tại**, không theo season query param được truyền vào (verify thật: Luton Town id=389 trả 403 khi hỏi squad season 2023 dù họ có đá Premier League season đó, vì hiện tại đã xuống hạng khỏi mọi giải free-tier) — trả `[]` + log warn thay vì throw, để không chặn cả job sync khi gặp team dạng này.

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
- Web: Web app đã đăng ký trong `jankara-e2e-test` qua `firebase apps:create WEB` (app id `1:264468798864:web:165e6c75fad5e45e07e715`). Firebase JS SDK ở `apps/web/src/lib/firebase.ts`, config qua `NEXT_PUBLIC_FIREBASE_*` trong `apps/web/.env.local` (gitignored, cùng lý do với mobile — xem "### Secrets & credentials"; lấy lại bằng `firebase apps:sdkconfig WEB <app-id> --project jankara-e2e-test`, xem `.env.example`). Auth context (Google popup + Phone 2-step) ở `apps/web/src/lib/auth-context.tsx`, UI ở `apps/web/src/app/auth/page.tsx` + `AuthStatus` trong NavBar. Dev local dùng Firebase Auth Emulator qua `connectAuthEmulator` (guard `NODE_ENV === "development"`) — đã verify thật token do emulator cấp có `aud`/`iss` khớp `demo-football-app` (project giả emulator dùng, không phải `jankara-e2e-test`), đúng với `FIREBASE_PROJECT_ID` mặc định của `apps/api`, nên web + api tương thích khi cùng chạy qua Docker emulator.
- Backend verify token qua `requireAuth` middleware (`apps/api/src/middleware/auth.ts`) dùng `firebase-admin` — chạy qua `pnpm docker:up` đã tự set `FIREBASE_AUTH_EMULATOR_HOST=firebase-emulator:9099` (xem "### Docker"), không cần project thật để test local; set `FIREBASE_PROJECT_ID`/`FIREBASE_SERVICE_ACCOUNT` trong `.env` khi cần verify token thật từ `jankara-e2e-test`. Dùng chung cho web + mobile.
- `requireAuth` KHÔNG set raw Firebase UID vào context. Sau `verifyIdToken`, nó resolve-or-create `User` row nội bộ theo `User.firebaseUid` (just-in-time provisioning — chưa có flow signup/profile riêng ở Phase 1) rồi `c.set("userId", internalUser.id)`. Vì vậy `c.get("userId")` trong route là `User.id` (cuid) FK-safe, dùng trực tiếp cho query Prisma (ví dụ `FavoriteTeam.userId`/`FavoritePlayer.userId`) — không phải raw Firebase UID. `User.email` là optional (`String?`) vì user đăng nhập bằng phone không có email claim.
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
