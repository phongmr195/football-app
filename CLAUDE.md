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

## Quy ước bắt buộc theo (đọc kỹ trước khi thêm code mới)

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
- Backend verify token qua `requireAuth` middleware (`apps/api/src/middleware/auth.ts`) dùng `firebase-admin` — set `FIREBASE_AUTH_EMULATOR_HOST` khi test local (không cần project thật), set `FIREBASE_PROJECT_ID`/`FIREBASE_SERVICE_ACCOUNT` khi có project thật. Dùng chung cho web + mobile.
- Facebook login: chưa thêm (cần tạo Facebook App trước tại developers.facebook.com), thêm khi có nhu cầu thật.
- `firebase-tools` CLI (đã cài global) dùng cho `flutterfire configure`/`firebase emulators:start`/`firebase login`.

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
