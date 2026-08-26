# Football App — CLAUDE.md

Monorepo cho Football App. Kiến trúc đầy đủ + roadmap: [docs/architecture/PROJECT_PLAN.md](docs/architecture/PROJECT_PLAN.md), [docs/architecture/ROADMAP.md](docs/architecture/ROADMAP.md).

> **Pivot (2026-08-07):** client chính chuyển từ Mobile (Flutter) sang **Web (Next.js)**. `apps/mobile` đã xoá hẳn (2026-08-22), không còn kế hoạch resume — xem git history nếu cần code cũ.

## Tech stack

- **Web** (client chính): Next.js (React) + shadcn/ui, Firebase Authentication (Google/Facebook/username-password) qua Firebase JS SDK.
- **Backend**: Node.js, Hono, TypeScript, Zod (`@hono/zod-validator`), Prisma, `firebase-admin`.
- **Database**: Aurora PostgreSQL (Prisma), Redis (cache + Pub/Sub cho real-time/push).
- **AI**: gọi thẳng Anthropic API qua `packages/ai-provider` (không qua Bedrock) — xem [packages/ai-provider/CLAUDE.md](packages/ai-provider/CLAUDE.md).
- **Data provider**: `football-data.org` (mặc định) qua adapter pattern (`packages/data-provider`) — xem "### Data provider" dưới.
- **Infra**: Terraform (chưa apply), Turborepo + pnpm workspaces.
- **Secret scanning**: `secretlint` qua Husky pre-commit + CI backstop — xem "### Secrets & credentials".

## Cấu trúc monorepo

```
apps/
  web/            Next.js — client chính + /admin/* (cùng port, xem "### Admin" dưới)
  api/            Hono API (TypeScript)
  sync-worker/    Đồng bộ dữ liệu từ data provider + polling live match
  scraper-sofascore/  Python — scrape data từ Sofascore, xem [apps/scraper-sofascore/CLAUDE.md](apps/scraper-sofascore/CLAUDE.md)
packages/
  database/       Prisma schema + client
  shared/         Types/utils dùng chung TS
  data-provider/  Canonical model + adapter pattern cho data provider bóng đá
  ai-provider/    LlmProvider interface + adapter (xem packages/ai-provider/CLAUDE.md)
  realtime/       RealtimeTransport interface + Redis Pub/Sub adapter
  ui/             Design system cũ (đang migrate dần sang shadcn)
  config/         eslint/tsconfig/prettier chung
```

## Lệnh hay dùng

```bash
pnpm install
pnpm db:generate        # generate Prisma client sau khi sửa schema.prisma
pnpm dev                # chạy tất cả apps qua turbo
pnpm lint / typecheck / build / test    # chạy toàn monorepo qua turbo
```

**`pnpm install` KHÔNG tự build workspace package mới** — thiếu `dist/` sẽ làm consumer lỗi
`Cannot find module` dù install chạy xong không báo lỗi. Sau khi pull code có package mới, chạy
`pnpm build` toàn repo trước khi trust mọi thứ sẵn sàng.

```bash
# Docker — xem "### Docker" dưới
cp .env.example .env  # optional
pnpm docker:up      # postgres + redis + dozzle + firebase-emulator + api
pnpm docker:worker  # sync-worker 1 lượt
pnpm docker:test    # test suite trong container
pnpm docker:down
```

## Quy ước bắt buộc theo (đọc kỹ trước khi thêm code mới)

### Secrets & credentials
- **3 lớp bảo vệ, không lớp nào tự đủ**: `.gitignore` (chặn tên file credential đã biết) → Husky
  pre-commit (`secretlint` bắt nội dung + `scripts/block-credential-files.sh` bắt tên file, chặn cả
  khi `git add -f`) → CI job `secretlint` (backstop nếu ai `--no-verify`).
- **secretlint KHÔNG bắt được Firebase/Google client API key** (`AIzaSy...`, chủ đích của Google —
  key này an toàn để public) — lớp #1/#2 (theo TÊN FILE) mới là bảo vệ thật cho loại file này.
- Cần bypass hợp lệ (file `.example` false-positive) → sửa `.lintstagedrc.json`/`.secretlintrc.json`
  thêm exception, KHÔNG `git commit --no-verify` trừ khi đã hỏi user trước.

### Backend (`apps/api`)
- Route mới → 1 file `apps/api/src/routes/<module>.ts`, export 1 `Hono` instance, mount qua
  `app.route(...)`.
- Validate input bằng `@hono/zod-validator`, KHÔNG parse tay bằng `schema.parse()` trong handler.
- Cần auth → middleware `requireAuth` (`src/middleware/auth.ts`), đọc `userId` qua `c.get("userId")`.
- Đọc/ghi DB qua `prisma` từ `@football-app/database` — không tạo `PrismaClient` mới trong route.
- Dùng skill `add-api-module` để scaffold module mới.

### Database (`packages/database`)
- Model mới: `id String @id @default(cuid())`, tên bảng snake_case qua `@@map("...")`. Entity map
  với data provider → thêm `externalRef Json?` (camelCase, không `@map`), shape bắt buộc
  `{ provider: string, id: string }`.
- **Model có `externalRef` BẮT BUỘC unique expression index** trên
  `(externalRef->>'provider', externalRef->>'id')`, partial `WHERE "externalRef" IS NOT NULL` — 2
  provider khác nhau có thể trùng id số (vd cả 2 dùng id "39" cho 2 entity khác nhau); lookup chỉ
  theo `id` có thể match nhầm row. Prisma không biểu diễn được expression index → viết migration
  tay (xem style ở `packages/database/prisma/migrations/20260813000000_*`), dùng B-tree.
- **Lookup theo `externalRef` LUÔN filter cả `provider` VÀ `id`**:
  ```ts
  prisma.<model>.findFirst({
    where: { AND: [
      { externalRef: { path: ["provider"], equals: provider } },
      { externalRef: { path: ["id"], equals: externalId } },
    ] },
  })
  ```
- Sau khi sửa schema: `pnpm db:generate` (chỉ sinh lại Client, KHÔNG áp migration vào DB thật) rồi
  `pnpm db:migrate`/`db:migrate:deploy` khi có DB thật — đừng chỉ tin `db:generate` chạy xong là đủ.
- Dùng skill `add-prisma-model` khi thêm model mới.
- Sửa tay data sai từ provider → CRUD `/admin/*`. `pnpm db:studio` chỉ cho việc XOÁ thật (admin CRUD
  không có nút Delete) hoặc model chưa có trang admin.

### Data provider (`packages/data-provider`)
- KHÔNG để downstream code biết hình dạng JSON thật của provider — luôn map qua canonical model
  trong `src/types.ts` trước.
- Provider mới → adapter trong `src/adapters/`, implement `DataProviderAdapter`, KHÔNG sửa
  canonical model để khớp provider mới.
- **Mặc định: `football-data.org`** (`FootballDataAdapter`) — không phải API-Football (free tier
  bị suspend account nhiều lần + quota 100 req/ngày quá chật). football-data.org free tier: 10
  req/phút, KHÔNG giới hạn/ngày, phủ 13 giải lớn. `ApiFootballAdapter` vẫn giữ làm adapter phụ.
- Chọn qua `createAdapter()` (`apps/sync-worker/src/provider.ts`), env `DATA_PROVIDER`
  (`"football-data"` mặc định | `"api-football"`).
- Mỗi adapter tự throttle qua `rate-limiter.ts`, margin an toàn dưới giới hạn thật (8 req/phút cho
  cả 2, dưới hard cap 10/phút) — adapter mới PHẢI tự cân nhắc rate limit tương tự.
- `FootballDataAdapter.fetchPlayers` bắt riêng HTTP 403 từ `GET /teams/{id}` — provider gate theo
  giải team đang đá **hiện tại**, không theo season param truyền vào (team đã xuống hạng khỏi
  free-tier sẽ luôn 403 dù hỏi season cũ) — trả `[]` + log warn, không throw, để không chặn cả job.

### Docker
- `docker-compose.yml` (root) = local dev: `postgres`, `redis`, `dozzle` (:8080), `firebase-emulator`
  (project giả `demo-football-app`, API :9099, UI :4000), `api`, `sync-worker` (profile `worker`).
- `docker-compose.test.yml` = test cô lập, Postgres riêng ephemeral, build từ `Dockerfile.test`
  (không dùng `apps/*/Dockerfile` — đã prune xuống 1 app, không đủ chạy toàn bộ test suite).
- `apps/api/Dockerfile`, `apps/sync-worker/Dockerfile` = production, dùng
  `pnpm --filter=<pkg> --prod deploy --legacy /deploy/<name>`. Thêm app/package mới → copy đúng
  pattern 2 file này.
- **Cảnh báo máy dev**: Postgres.app (hoặc Postgres native khác) chiếm port 5432 sẽ âm thầm nhận
  hết traffic thay vì Docker container — `lsof -i :5432` trước khi debug "sao không thấy data".

### Web (`apps/web`)
- Next.js (App Router) + `packages/ui`, gọi `apps/api` trực tiếp (REST), Firebase JS SDK cho auth.
- Trang public nên dùng SSR/ISR cho SEO.
- Dùng skill `add-web-page` để scaffold page/feature mới.
- **shadcn/ui là design system chính** — component/trang MỚI luôn dùng shadcn
  (`npx shadcn@latest add <component>`) kể cả khi `packages/ui` đã có bản tương đương. `shadcn add`
  tự lỗi vì `packages/ui/package.json` thiếu `exports` field — tạm trả `aliases.utils` về
  `@/lib/utils` lúc chạy `add` rồi sửa tay import sau (chi tiết ở `.claude/agents/web-dev.md`).
  Chưa có `next-themes`/toggle `.dark` — nếu `shadcn init`/`add` tự thêm
  `@custom-variant dark (&:is(.dark *));` vào `globals.css` thì phải xoá, không sẽ tắt dark mode.
- **Live stream** (`Match.liveStreamUrl`, admin nhập tay) — `components/match/LiveStreamPlayer.tsx`
  tự phân loại: link YouTube (watch/embed/live/youtu.be) → `<iframe>` embed; còn lại coi là HLS
  `.m3u8` → `<video>` + `hls.js` (Safari phát HLS native, không cần lib). Chỉ hiện trong
  `LiveMatchPanel` (đã tự gate theo live state thật qua client poll, không dùng `match.status` từ
  ISR có thể stale). Menu `/live` (`GET /matches/live-streams`) liệt kê match LIVE/HALFTIME/
  SCHEDULED **có link** — khác `GET /matches/live` (dùng cho ticker trang chủ, trả MỌI match LIVE
  bất kể có link hay không), không gộp chung 2 endpoint.
- **Comment trận đấu** (`MatchComment`, `components/match/MatchComments.tsx`) — hiện trên toàn bộ
  `/matches/[id]` (không phụ thuộc live), realtime qua kênh Redis riêng
  `live:match:${matchId}:comments` (khác kênh `LiveUpdateEvent`), forward qua WS dưới message type
  `"comment.new"` — xem `apps/api/src/lib/redis.ts`'s `publishComment()` +
  `apps/api/src/realtime/ws-server.ts`. `@mention` CHỈ resolve được username của user ĐÃ TỪNG
  comment trận đó (không có endpoint search user toàn hệ thống — chủ đích, tránh lộ username tuỳ
  ý). Publish trực tiếp từ `apps/api` (KHÔNG dùng `packages/realtime`'s `RealtimeTransport` —
  interface đó chủ ý chỉ dành cho sync-worker, xem doc comment ở `publisher.interface.ts`).

### Admin (`apps/web/src/app/admin/*`)
- Sống chung `apps/web` (không phải app/port riêng), chỉ khác route `/admin/login`.
  `ConditionalWebChrome` ẩn `NavBar`/`PushNotificationListener` khi path bắt đầu `/admin`.
- **Auth tách biệt hoàn toàn khỏi Firebase** — bảng `AdminUser` riêng (bcrypt `passwordHash`), JWT
  tự ký (`requireAdminSession`, `ADMIN_JWT_SECRET`). Token lưu `localStorage` (tradeoff so với
  httpOnly cookie, chấp nhận được cho tool nội bộ). KHÔNG dùng `User`/`firebaseUid`/`requireAuth`.
- Tạo/reset admin qua CLI: `pnpm --filter @football-app/api create-admin <username> <password>`.
- **CRUD chung cho Competition/Season/Team/Player/Stadium/Coach/Referee** —
  `ResourceTable`/`ResourceFormDialog`/`AdminResourcePage`. KHÔNG có Delete cho model có
  `onDelete: Cascade` sâu — Prisma Studio là escape hatch xoá thật.
- `Match`: sửa qua `PATCH /matches/:id` + `LiveMatchState` qua `PUT /matches/:id/live` (1 trang, 2
  endpoint) — cùng form có field `liveStreamUrl` (YouTube hoặc HLS `.m3u8`, xem "### Web" dưới cho
  cách nhúng). `AppConfig`: trang riêng, value JSON qua textarea. `NotificationLog`: read-only.
- `/admin/scraper`: trigger pipeline Sofascore — xem
  [apps/scraper-sofascore/CLAUDE.md](apps/scraper-sofascore/CLAUDE.md).

### Authentication (Firebase Auth)
- Web app đăng ký trong Firebase project `jankara-e2e-test` (dùng chung, không riêng app này). SDK
  ở `apps/web/src/lib/firebase.ts`, config qua `NEXT_PUBLIC_FIREBASE_*` (`.env.local`, gitignored).
  Auth context (Google/Facebook popup + username/password) ở `lib/auth-context.tsx`.
- **Phone sign-in đã BỎ** (không có free tier từ Firebase, tính phí theo SMS) — thay bằng
  **username/password tự build** (`apps/api/src/routes/auth.ts`) cho user thường, khác hoàn toàn
  `AdminUser`. Đăng ký/đăng nhập thành công mint 1 Firebase custom token
  (`createCustomToken(uid)`), client `signInWithCustomToken()` ra ID token THẬT — nhờ vậy
  `requireAuth` không cần sửa gì để hỗ trợ auth method mới. `User.firebaseUid` cho nhóm này là giá
  trị TỰ SINH (`pw_${randomUUID()}`), không phải Firebase cấp.
- Dev local mặc định dùng Firebase Auth Emulator (`connectAuthEmulator`, guard
  `NODE_ENV === "development"`). Test với account Google/Facebook thật → set
  `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false` + đổi `apps/api` sang `FIREBASE_PROJECT_ID` thật cùng lúc
  (2 bên phải khớp `aud`/`iss`, không thì `requireAuth` verify fail).
- `requireAuth` KHÔNG set raw Firebase UID vào context — resolve-or-create `User` theo
  `firebaseUid` rồi `c.set("userId", internalUser.id)` (cuid, FK-safe).
- **Facebook login**: code đã wire nhưng cần enable tay ở Firebase Console (Sign-in method →
  Facebook, App ID/Secret) + whitelist redirect URI — chưa enable thì lỗi `auth/operation-not-allowed`.
- **Web Push (FCM)** — hoạt động thật, các điểm cần nhớ:
  - Service worker `/firebase-messaging-sw.js` là 1 Route Handler (không phải file tĩnh) — tự đọc
    env server-side, không cần copy config tay.
  - Tab đang focus KHÔNG tự hiện notification (hành vi thật của FCM Web) — phải tự code
    `onMessage()` + `new Notification()` ở client (`listenForForegroundMessages()`).
  - Thiếu `FIREBASE_SERVICE_ACCOUNT` ở `apps/api` → gửi FCM lỗi "Could not load default
    credentials" (khác `verifyIdToken`, chỉ cần `projectId`) — đã catch, ghi `NotificationLog`
    FAILED, không crash, nhưng silent nếu không chủ động check bảng đó.
  - `subscribeChannel()` phải đợi Redis `"ready"` trước khi subscribe, không sẽ miss message vô
    thời hạn mà không throw lỗi gì.
  - macOS có thể chặn notification ở cấp OS (System Settings) độc lập với quyền browser — kiểm tra
    cả 2 lớp khi debug push không hiện.

## Git / branch protection

- `main` và `develop` yêu cầu PR để merge (không push thẳng, không force-push/xoá branch).
- Nhánh feature không bị giới hạn — push thẳng, mở PR khi cần merge vào `develop`.
