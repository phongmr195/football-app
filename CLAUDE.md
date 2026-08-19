# Football App — CLAUDE.md

Monorepo cho Football App. Kiến trúc đầy đủ + roadmap: [docs/architecture/PROJECT_PLAN.md](docs/architecture/PROJECT_PLAN.md), [docs/architecture/ROADMAP.md](docs/architecture/ROADMAP.md).

> **Pivot (2026-08-07):** client chính chuyển từ Mobile (Flutter) sang **Web (Next.js)**. `apps/mobile` tạm pause — code giữ nguyên, quy ước Mobile dưới đây vẫn đúng, chỉ không phải track đang active. Xem lý do ở [PROJECT_PLAN.md § 1 Pivot](docs/architecture/PROJECT_PLAN.md#pivot-web-trước-mobile-tạm-pause-2026-08-07).

## Tech stack

- **Web** (client chính): Next.js (React), Firebase Authentication (Google/Phone/Facebook) qua Firebase JS SDK — đã scaffold + browse pages + favorites + real-time (Phase 1+2), xem ROADMAP
- **Mobile** (tạm pause): Flutter, Riverpod, GoRouter, Hive, Dio — đã có Phase 0 + auth, xem [ROADMAP.md § Mobile — tạm pause](docs/architecture/ROADMAP.md#mobile--tạm-pause-trạng-thái-tại-thời-điểm-pause)
- **Auth**: Firebase Authentication (Google + Phone + Facebook đều đã enable) — đổi từ AWS Cognito, xem [PROJECT_PLAN.md § Authentication](docs/architecture/PROJECT_PLAN.md#authentication--quyết-định-đổi-từ-cognito-sang-firebase-auth-2026-08-06). Firebase project hiện dùng: `jankara-e2e-test` (project dùng chung, không riêng cho football-app).
- **Backend**: Node.js, Hono, TypeScript, Zod (`@hono/zod-validator`), Prisma, `firebase-admin` (verify token + gửi FCM push)
- **Database**: Aurora PostgreSQL (Prisma), Redis (cache + Pub/Sub cho real-time/push, xem Phase 2), Postgres FTS/pgvector cho search/AI (xem PROJECT_PLAN.md § 7.1 — hoãn OpenSearch tới khi cần)
- **AI**: gọi thẳng Anthropic API (Claude) qua `packages/ai-provider` — KHÔNG qua AWS Bedrock (đổi quyết định 2026-08-18, xem "### AI" dưới + ROADMAP Phase 5). Embedding cho Chat/RAG (Phase 5 piece sau) chưa chọn provider chốt — đang nghiêng OpenAI `text-embedding-3-small`, xem ROADMAP Phase 5.
- **Data provider**: `football-data.org` (mặc định) qua adapter pattern (`packages/data-provider`) — API-Football vẫn giữ làm adapter phụ, đổi default vì API-Football free tier bị suspend nhiều lần, xem "### Data provider" dưới
- **Infra**: Terraform (`infrastructure/terraform`, chưa apply), Turborepo + pnpm workspaces
- **Secret scanning**: `secretlint` qua Husky pre-commit + CI backstop — xem "### Secrets & credentials"
- **Docker**: `docker-compose.yml` (data: Postgres+Redis, log: Dozzle, auth: Firebase Auth Emulator, app: api+sync-worker) cho local dev; `docker-compose.test.yml` cho test cô lập; `apps/api/Dockerfile` + `apps/sync-worker/Dockerfile` multi-stage production-ready (dùng `pnpm deploy`)

## Cấu trúc monorepo

```
apps/
  web/            Next.js — client chính (browse pages, favorites, real-time) + /admin/* (ROADMAP Phase 4, cùng port, xem "### Admin" dưới)
  mobile/         Flutter app — TẠM PAUSE, giữ code
  api/            Hono API (TypeScript)
  sync-worker/    Đồng bộ dữ liệu từ data provider + polling live match
  scraper-sofascore/  Python (không qua pnpm/turbo) — scrape Events/Lineups/Stats từ Sofascore, xem "### Scraper" dưới
packages/
  database/       Prisma schema + client (export từ packages/database/src/index.ts)
  shared/         Types/utils dùng chung TS (pagination, ApiError, admin-password hash/verify)
  data-provider/  Canonical model + adapter pattern cho data provider bóng đá
  ai-provider/    LlmProvider interface + Anthropic adapter (gọi thẳng API, không qua Bedrock — Phase 5)
  realtime/       RealtimeTransport interface + Redis Pub/Sub adapter (WebSocket + goal push, Phase 2)
  ui/             Design system — dùng cho apps/web (Button/Card/Badge/Container...)
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

**`pnpm install` chỉ link workspace package (symlink qua `node_modules/@football-app/<pkg>`), KHÔNG tự build nó** — package mới (`main`/`types` trỏ `dist/...`) thiếu `dist/` sẽ làm consumer (`apps/api`, v.v.) lỗi `Cannot find module`/`error TS2307` dù `pnpm install` chạy xong không báo lỗi gì. Bug thật gặp 2026-08-17 với `packages/realtime` (đã merge từ PR khác nhưng chưa từng build ở máy dev khác). Sau khi `git pull`/checkout code có thêm package mới, chạy `pnpm build` toàn repo (hoặc `pnpm --filter <pkg> build` riêng) trước khi trust rằng mọi thứ đã sẵn sàng.

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
- **`pnpm db:generate` KHÔNG áp migration vào DB thật** — chỉ sinh lại Prisma Client theo `schema.prisma`. Bug thật gặp 2026-08-17: `schema.prisma` đã có `DevicePlatform.WEB` (merge từ PR khác), `db:generate` chạy bình thường không báo lỗi gì, nhưng DB dev local chưa hề chạy `pnpm db:migrate`/`db:migrate:deploy` nên enum Postgres thật vẫn chỉ có `IOS`/`ANDROID` — lỗi chỉ lộ ra lúc insert thật (`invalid input value for enum`). Sau khi `git pull`/merge PR có đổi schema, luôn chạy `db:migrate:deploy` thật trên DB đang dùng, đừng chỉ tin `db:generate` chạy xong là đủ.
- Dùng skill `add-prisma-model` khi thêm model mới.
- Sửa tay data sai từ provider → dùng CRUD `/admin/*` (Competition/Season/Team/Player/Stadium/Coach/Referee đã build, xem "### Admin" dưới). Chỉ dùng `pnpm db:studio` (Prisma Studio) cho việc XOÁ thật (admin CRUD không có nút Delete, có chủ đích) hoặc các model chưa có trang admin.

### Data provider (`packages/data-provider`)
- KHÔNG để downstream code (sync-worker, api) biết hình dạng JSON thật của provider — luôn map qua canonical model trong `src/types.ts` trước.
- Provider mới → thêm adapter trong `src/adapters/`, implement `DataProviderAdapter` interface, KHÔNG sửa canonical model để khớp provider mới (ngược lại).
- **Provider mặc định (2026-08-13): `football-data.org`** (`FootballDataAdapter`), KHÔNG phải API-Football — API-Football free tier bị **suspend account thật 3 lần** (3 key khác nhau) và quota 100 request/ngày quá chật. `football-data.org` free tier ("Free Forever", verify thật): **10 request/phút, KHÔNG có giới hạn/ngày**, phủ 13 giải lớn (Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, Eredivisie, Primeira Liga, Championship, Brasileirão, Copa Libertadores, World Cup, European Championship) — đủ scope MVP. `ApiFootballAdapter` vẫn giữ nguyên, tested, không bị xoá — chỉ không còn là default.
- `apps/sync-worker` chọn adapter qua `createAdapter()` (`apps/sync-worker/src/provider.ts`), đọc env `DATA_PROVIDER` (`"football-data"` mặc định | `"api-football"`). Set `FOOTBALL_DATA_API_KEY`/`API_FOOTBALL_KEY` tương ứng.
- Mỗi adapter tự throttle qua `rate-limiter.ts` (sliding-window, injectable clock) — margin an toàn dưới giới hạn thật của provider, KHÔNG sát biên: `ApiFootballAdapter` 8 req/phút (giới hạn cứng 10/phút VÀ 100/ngày), `FootballDataAdapter` 8 req/phút (giới hạn cứng 10/phút, KHÔNG giới hạn/ngày). Adapter mới cho provider khác PHẢI tự cân nhắc rate limit tương tự, không giả định provider không giới hạn.
- API-Football Free plan: full sync 1 giải ~20 team tốn ~70-80 request (phân trang squad) — chỉ đủ ngân sách ~1 giải/ngày. football-data.org không có giới hạn ngày nên không bị ràng buộc này, nhưng vẫn chỉ 10 req/phút — full sync 1 giải/season (~26 request: competitions+seasons+teams×2+players×20 team+standings+matches) mất vài phút do rate limiter, đừng chạy đồng thời nhiều `SYNC_COMPETITION_IDS` nếu cần nhanh.
- `FootballDataAdapter.fetchPlayers` bắt riêng lỗi HTTP 403 từ `GET /teams/{id}` — provider gate quyền truy cập theo giải team đang đá **hiện tại**, không theo season query param được truyền vào (verify thật: Luton Town id=389 trả 403 khi hỏi squad season 2023 dù họ có đá Premier League season đó, vì hiện tại đã xuống hạng khỏi mọi giải free-tier) — trả `[]` + log warn thay vì throw, để không chặn cả job sync khi gặp team dạng này.

### AI (`packages/ai-provider`, ROADMAP Phase 5)
- **Gọi thẳng Anthropic API, KHÔNG qua AWS Bedrock** (quyết định 2026-08-18) — Bedrock cần mở AWS account thật + xin quyền truy cập model (approval, có thể mất thời gian) + IAM riêng, không có lợi ích thật ở quy mô app này.
- `LlmProvider` interface (`src/provider.interface.ts`) + `AnthropicAdapter`/`GeminiAdapter` (`src/adapters/*.adapter.ts`) — mirror chính xác pattern `DataProviderAdapter` ở `packages/data-provider`: constructor `{ apiKey, model?, fetchImpl? }` dùng `fetch` gốc (không thêm SDK/axios), KHÔNG throw ở constructor nếu thiếu `apiKey` (lỗi thật chỉ lộ lúc gọi `generateText()` — cho phép build/test code trước khi có API key thật).
- `apps/sync-worker` chọn qua `createLlmProvider()` (`src/ai-provider.ts`), đọc env `LLM_PROVIDER` (`"anthropic"` mặc định | `"gemini"` | `"groq"`). Anthropic: set `ANTHROPIC_API_KEY`, tuỳ chọn `ANTHROPIC_MODEL` (mặc định `claude-haiku-4-5-20251001` — rẻ nhất, đủ cho việc tóm tắt kết quả trận đấu, không cần suy luận phức tạp). Gemini: set `GEMINI_API_KEY`, tuỳ chọn `GEMINI_MODEL` (mặc định `gemini-3.5-flash-lite` — đổi từ `gemini-2.5-flash-lite` sau khi verify thật 2026-08-18: Google đã deprecate model đó cho user mới, request trả 404 kèm chỉ dẫn trực tiếp dùng bản 3.5) — **free tier thật** (Google AI Studio, không cần thẻ tín dụng), lựa chọn tốt nếu không muốn phụ thuộc trả phí cho việc chỉ tóm tắt vài câu.
- **`GroqAdapter`** (`src/adapters/groq.adapter.ts`) — **free tier thật** (Groq Cloud, không cần thẻ tín dụng), API **OpenAI-compatible** (`POST https://api.groq.com/openai/v1/chat/completions`, header `authorization: Bearer <key>`), suy luận rất nhanh (LPU inference). Set `LLM_PROVIDER=groq` + `GROQ_API_KEY`, tuỳ chọn `GROQ_MODEL` (mặc định `openai/gpt-oss-20b`). **Verify thật 2026-08-19**: model mặc định lúc viết ban đầu (`llama-3.3-70b-versatile`, đoán theo model phổ biến hay nhắc tới) đã KHÔNG còn tồn tại trên Groq nữa (404 `model_not_found`) — danh mục model Groq đổi khá thường xuyên, `GET /openai/v1/models` (kèm `authorization` header) mới là nguồn đúng để tra model đang khả dụng, đừng tin tên model cứng trong doc/training data. Đã đổi default sang `openai/gpt-oss-20b`, verify gọi thành công thật (trả lời đúng nội dung, có `usage`).
- **`FallbackLlmProvider`** (`packages/ai-provider/src/fallback-provider.ts`) — compose 2 `LlmProvider`: gọi primary trước, primary fail (network lỗi, rate limit...) thì tự chuyển qua fallback, throw 1 lỗi gộp (giữ message cả 2 bên) nếu CẢ 2 đều fail. Bật qua env `LLM_FALLBACK_PROVIDER` (optional, cùng 3 giá trị `"anthropic"/"gemini"/"groq"`) ở cả `apps/api`/`apps/sync-worker`'s `createLlmProvider()` — vd `LLM_PROVIDER=gemini` + `LLM_FALLBACK_PROVIDER=groq` để tự chuyển qua Groq free tier khi Gemini free tier bị rate limit. Case thật đã gặp (2026-08-19): `backfill-player-summaries` chạy 100 cầu thủ liên tiếp bằng Gemini free tier bị 429 `RESOURCE_EXHAUSTED` giữa chừng (quota 15 req/phút) — fix tạm bằng delay 4.5s/request giữa các lần gọi trong script (`backfill-player-summaries.ts`), `LLM_FALLBACK_PROVIDER` là lựa chọn khác cho job cần chạy nhanh hơn không muốn đợi throttle.
- **Cân nhắc đã bỏ**: ban đầu có thêm `NgrokAdapter` (gọi 1 server LLM tự host đứng sau ngrok tunnel) nhưng đã XOÁ (2026-08-19) — hiểu nhầm ban đầu tưởng ngrok tự có API AI, thực ra ngrok bản thân KHÔNG có API AI/summary nào (chỉ là tunnel, model thật vẫn phải tự host ở đâu đó). `GroqAdapter` (free tier thật, không cần tự host gì) giải quyết đúng nhu cầu thật hơn nên không cần giữ `NgrokAdapter`.
- **`GeminiAdapter` — 2 điểm casing KHÔNG NHẤT QUÁN trong chính docs của Google, chưa verify thật bằng key thật lúc viết** (xem comment trong file): `generationConfig.maxOutputTokens` xác nhận camelCase (REST reference chính thức), nhưng field top-level `system_instruction` lại là snake_case theo đúng ví dụ REST chính thức của Google (`google-gemini/cookbook`) — khác hẳn convention camelCase còn lại của cùng API. Đã theo đúng ví dụ chính thức thay vì đoán theo pattern chung. Key truyền qua header `x-goog-api-key` (không phải query param `?key=`, tránh lộ key vào access log). Verify lại field `system_instruction` đầu tiên nếu gặp lỗi 400 khi gắn `GEMINI_API_KEY` thật.
- **`ai_match_summary`** (`apps/sync-worker/src/match-summary.ts`'s `generateMatchSummaryIfNeeded()`) sinh khi match chuyển sang FINISHED, trigger từ 2 nơi độc lập (`sync-live-matches.ts` + `sync-catalog.ts`'s `syncMatches()`, xem comment tại 2 chỗ gọi) — hàm tự idempotent (guard bằng `AiMatchSummary.matchId` đã `@unique`), an toàn khi cả 2 nơi cùng trigger. Gọi KHÔNG `await` (`void ...catch()`) để không chặn vòng lặp sync chính.
- **`Commentary`/`MatchEvent` đều rỗng hoàn toàn trong DB thật** (verify 2026-08-18, 2701 match FINISHED nhưng 0 dòng ở cả 2 bảng) — không adapter provider nào (`FootballDataAdapter`/`ApiFootballAdapter`) từng ghi vào đây. `ai_match_summary` vì vậy chỉ dựa trên tỉ số cuối + `Standing` (vị trí bảng xếp hạng), KHÔNG thể tường thuật diễn biến theo phút — giới hạn dữ liệu thật, không phải giới hạn của tính năng AI. Nếu sau này cần tường thuật chi tiết, phải giải quyết ở tầng data-provider trước (thêm fetch/map commentary/event thật), không phải sửa ở tầng AI.
- Script backfill 1 lần: `pnpm --filter @football-app/sync-worker backfill-match-summaries [limit]` (mặc định `limit=5`) — cần thiết vì match đã FINISHED từ trước khi tính năng này tồn tại sẽ không bao giờ tự trigger. Mỗi match tốn 1 lần gọi API thật (tính phí) — không chạy không giới hạn khi mới test key.
- **KHÔNG dùng `AiUsageLog`** cho `ai_match_summary` — model đó thiết kế cap usage theo user (`userId` bắt buộc), nhưng đây là job hệ thống sinh 1 lần dùng chung, không có user để gán quota. Chỉ `console.log` structured token/cost (bảng giá cứng nhỏ theo model trong `match-summary.ts`). `AiUsageLog` sẽ dùng thật ở piece Chat/player-compare (user-triggered, cần cap theo user).
- **KHÔNG dùng Redis Pub/Sub cho trigger này** (khác goal-notifier ở Phase 2) — phát hiện (match vừa FINISHED) lẫn xử lý (gọi LLM, lưu `AiMatchSummary`) đều nằm trong sync-worker, thêm channel mới chỉ để tự nói chuyện với mình là phức tạp không cần thiết.
- Test: `packages/ai-provider`'s adapter test dùng `fetchImpl` giả (không cần key thật). `apps/sync-worker`'s `match-summary.test.ts` inject fake `LlmProvider` qua tham số thứ 2 của `generateMatchSummaryIfNeeded()`. **Quan trọng**: `sync-catalog.test.ts`/`sync-live-matches.test.ts` PHẢI mock module `"./ai-provider"` (giống cách đã mock `"./provider"`/`"./realtime"`) — nếu không, test 1 match FINISHED sẽ gọi `createLlmProvider()` thật (network thật tới Anthropic với key rỗng) làm chậm/flaky test không liên quan.
- `apps/api` cũng phụ thuộc `@football-app/ai-provider` (từ piece player-compare, `apps/api/src/ai-provider.ts`'s `createLlmProvider()`, cùng pattern `LLM_PROVIDER` env như sync-worker) — dùng cho mọi tính năng AI gọi đồng bộ theo request của user (`player_compare`, `chat`), khác `ai_match_summary`/`ai_player_summary` là job nền chạy trong sync-worker.
- **`AiUsageLog` đã có 2 consumer thật**: `player_compare` (cap 20/user/24h, `apps/api/src/routes/player-compare.ts`) và `chat` (cap 30/user/24h, `apps/api/src/routes/chat.ts`) — cả 2 check count trước khi gọi LLM, trả 429 nếu vượt cap.
- **`chat`** (`apps/api/src/routes/chat.ts` + `apps/api/src/chat-retrieval.ts`, web: `apps/web/src/app/chat/page.tsx`) — piece cuối Phase 5, hoàn thành 2026-08-19. **Quyết định (đã hỏi user): dùng "RAG-lite" qua SQL retrieval trực tiếp, KHÔNG build embedding/pgvector** — tự check DB trước khi thiết kế thấy corpus text thật chỉ ~7 dòng (2 `AiMatchSummary` + 1 `AiPlayerSummary` + 4 `AiPlayerComparison`), vector search không có giá trị ở quy mô này; để lại cho piece sau khi corpus đủ lớn (đúng nguyên tắc PROJECT_PLAN §7.1 "chỉ thêm infra khi có nhu cầu đo được"). `PromptTemplate`/`Embedding` (đã có sẵn trong schema, scaffold từ trước) vẫn CHƯA dùng — không có consumer thật, giữ nguyên chờ piece pgvector.
  - Retrieval: raw SQL `ILIKE '%' || name || '%'` quét tên Team/Player xuất hiện trong tin nhắn (đẩy scan xuống Postgres qua `$queryRaw`, không load hết tên vào memory), ngưỡng `length(name) >= 4` tránh match nhầm tên ngắn. Mỗi entity khớp được → kèm `TeamStatistics`/`PlayerStatistics` mùa gần nhất + `AiMatchSummary`/`AiPlayerSummary` liên quan vào context block đưa vào prompt.
  - **Hạn chế đã biết, chấp nhận cho v1** (verify thật qua câu hỏi nối tiếp dùng đại từ, ví dụ "Cậu ấy đá cho đội nào?"): retrieval chỉ quét tin nhắn MỚI NHẤT, không quét lại toàn bộ lịch sử session — AI đúng khi trả lời "không có thông tin" thay vì bịa, nhưng cũng có nghĩa câu hỏi nối tiếp dùng đại từ thay tên riêng sẽ không tự tìm lại được context nếu bản thân câu trả lời trước đó của AI không nhắc lại tên đó. Không xử lý dấu (ILIKE không fold accent — cần `unaccent` extension, không thêm cho piece này); không resolve theo cặp "đội A vs đội B" trong 1 câu, chỉ resolve từng Team/Player riêng lẻ.
  - `ChatHistory.sessionId` (schema có sẵn, không cần bảng `ChatSession` riêng) — không truyền `sessionId` thì tự tạo mới (`randomUUID()`). `GET /chat/sessions/:sessionId/messages` LUÔN filter thêm `userId` (không chỉ `sessionId`) — không tin `sessionId` một mình là biên giới quyền truy cập.

### Scraper (`apps/scraper-sofascore`) — Events/Lineups/Player ratings/Match statistics
- **Component Python ĐẦU TIÊN trong monorepo** (mọi thứ khác Node/TS) — dùng thư viện `soccerdata` để lấy data từ Sofascore. KHÔNG nằm trong pnpm workspace/`pnpm turbo run` — có `requirements.txt`/README riêng, tự setup venv.
- **Vì sao Python, không phải 1 adapter TS như `packages/data-provider`**: `soccerdata`'s Sofascore reader (và MỌI request tới Sofascore, kể cả lấy lịch thi đấu) đi qua `tls_requests` — thư viện **chủ động giả mạo TLS fingerprint (JA3) của browser thật** (tải native binary `bogdanfinn/tls-client` theo platform) để vượt Cloudflare bot-protection (verify thật: `curl` bị 403 dù có User-Agent giả, `tls_requests` thì không). Đây KHÔNG phải chỉ set header — Node `fetch` gốc không làm được việc này. **Rủi ro thật, đã cân nhắc và chấp nhận**: hành vi này khác hẳn việc gọi API đối tác có ToS cho phép (football-data.org/API-Football) — là chủ động bypass cơ chế chống bot, có rủi ro ToS + có thể gãy bất cứ lúc nào nếu Sofascore đổi cơ chế bảo vệ.
- **Phát hiện quan trọng**: `soccerdata.Sofascore` (class Python) chỉ implement 4 method (`read_leagues`/`read_seasons`/`read_league_table`/`read_schedule`) — KHÔNG có `read_events`/`read_lineup`/`read_player_match_stats` dù trang docs liệt kê "lineups, detailed statistics". Lấy 3 loại dữ liệu còn lại (Events/Lineups/Player ratings/Match statistics) bằng cách gọi TRỰC TIẾP 3 endpoint Sofascore không được `soccerdata` wrap (`GET /event/{id}/incidents|lineups|statistics`), dùng CHUNG session đã bypass Cloudflare sẵn (`sofascore_client._session.get(...)`).
- **Pipeline 3 bước, giao tiếp qua file JSON, KHÔNG để Python đụng Postgres** (giữ bất biến "Prisma là nơi ghi DB duy nhất"):
  1. `pnpm --filter @football-app/sync-worker generate-sofascore-manifest -- --limit N` — Node query match FINISHED (Premier League, season 2025-2026) + roster 2 đội → `manifest.json`.
  2. `python scraper.py manifest.json output/` (trong `apps/scraper-sofascore`, cần `python3 -m venv .venv && pip install -r requirements.txt` trước) — resolve `game_id` Sofascore qua so khớp tên đội + ngày, gọi 3 endpoint, so khớp tên cầu thủ Sofascore với roster đã cho SẴN trong manifest (phạm vi 1 đội, an toàn hơn fuzzy-match toàn DB) → `output/<ourMatchId>.json`, ID đã resolve sẵn.
  3. `pnpm --filter @football-app/sync-worker ingest-sofascore [outputDir]` — đọc `output/`, upsert vào `MatchEvent`/`MatchLineup`/`Formation`/`PlayerRating`/`MatchStatistic` qua Prisma. Cầu thủ không khớp được (tên khác quá nhiều, hoặc thật sự chưa có trong DB) → skip + log, không chặn cả file (đúng convention `sync-catalog.ts`).
- **Bug thật đã gặp + fix khi verify (2026-08-18)**: với `incidentClass: "ownGoal"`, Sofascore's `isHome` phản ánh đội ĐƯỢC LỢI điểm số (đối phương của người đá phản lưới), KHÔNG PHẢI đội của cầu thủ ghi bàn — verify thật: Malo Gusto (Chelsea, đội khách) đá phản lưới, incident có `isHome: true`. Dùng thẳng `isHome` để chọn roster tra cầu thủ sẽ tra nhầm sang đội đối phương, luôn unmatched. Fix: đảo `isHome` riêng cho case own-goal trước khi chọn team/roster (`scraper.py`'s `map_events`).
- **Không chạy tự động/liên tục** — backfill có giới hạn (`--limit`), không wire vào `docker-compose.yml`/cron, chạy tay khi cần. Chỉ scope Premier League, mùa giải 2025-2026 (football-data.org đặt tên season theo NĂM BẮT ĐẦU — season tên **"2025"**, KHÔNG PHẢI "2026", mới là mùa 2025-2026 thật — verify thật qua `startDate`/`endDate`, đã có bug suýt chọn nhầm season "2026" vì nó được đánh dấu `isCurrent: true`).
- **`GET /matches/:id/events` (đã có sẵn từ Phase 2) tự động trả dữ liệu thật** ngay khi `MatchEvent` có data — không cần sửa API cho piece này. Chưa có endpoint public cho Lineups/Statistics/PlayerRating (ngoài scope piece này).
- Verify thật (2026-08-18): chạy full pipeline trên 3 match Premier League thật (mùa 2025-2026) — 49 event, 111 dòng lineup, 87 player rating, 6 dòng match statistic được ghi đúng vào DB dev; đối chiếu tay xác nhận own-goal/assist/possession đều đúng.

### Docker
- `docker-compose.yml` (root) = data/log/auth/app cho local dev: `postgres`, `redis`, `dozzle` (log viewer, http://localhost:8080), `firebase-emulator` (Auth Emulator, project giả `demo-football-app` — KHÔNG đụng project thật `jankara-e2e-test`; API :9099, UI :4000), `api`, `sync-worker` (profile `worker`, không tự chạy). Tất cả service dài hạn có `restart: unless-stopped`; `postgres`/`redis`/`firebase-emulator`/`api` có HEALTHCHECK, `api` depends_on cả 3 với `condition: service_healthy`.
- `api` mặc định trỏ `FIREBASE_AUTH_EMULATOR_HOST=firebase-emulator:9099` khi chạy qua `docker compose` — test đăng nhập/verify token KHÔNG cần Firebase project thật. Override qua `.env` (copy từ `.env.example`) nếu muốn verify token thật từ `jankara-e2e-test`.
- `docker-compose.test.yml` = test cô lập: `postgres-test` riêng (tmpfs, ephemeral) + `test-runner` build từ `Dockerfile.test` (KHÔNG dùng `apps/*/Dockerfile` cho test vì file đó đã prune xuống 1 app + prod deps qua `pnpm deploy`, không đủ để chạy toàn bộ test suite monorepo).
- `apps/api/Dockerfile`, `apps/sync-worker/Dockerfile` = production image, dùng `pnpm --filter=<pkg> --prod deploy --legacy /deploy/<name>` (pnpm v10 cần `--legacy` nếu không set `inject-workspace-packages=true`) để tách app + deps thật ra khỏi monorepo (không symlink) — pattern chuẩn của pnpm cho Docker. Có `RUN --mount=type=cache,target=/root/.local/share/pnpm/store` ở bước `pnpm install` để build sau nhanh hơn.
- Thêm app/package mới cần Dockerfile riêng → copy đúng pattern 2 file trên (base alpine + libc6-compat/openssl cho Prisma, build stage chạy `db:generate` + `turbo run build --filter=<pkg>...` + `pnpm deploy --legacy`, runtime stage chỉ copy `/deploy/<name>`).
- Postgres trong Docker dùng đúng port/user/pass khớp `packages/database/.env.example` (`postgres:postgres@localhost:5432/football_app`) — sửa 1 chỗ phải sửa chỗ kia theo, đừng để lệch.
- **Cảnh báo máy dev cụ thể**: nếu có Postgres.app (hoặc bất kỳ Postgres native nào) đang chạy trên máy, nó chiếm port 5432 và **âm thầm nhận hết traffic từ host tới `localhost:5432`** thay vì Docker container (bind cụ thể `127.0.0.1` được ưu tiên hơn bind wildcard `0.0.0.0` của Docker) — lệnh `prisma migrate`/`psql` chạy từ host tưởng đang nói với Docker Postgres nhưng thực ra vào native Postgres. Luôn `lsof -i :5432` kiểm tra trước khi debug "sao không thấy data" liên quan Docker Postgres.

### Web (`apps/web`) — client chính, đã scaffold
- Next.js (App Router) + `packages/ui`, gọi `apps/api` trực tiếp (REST), Firebase JS SDK cho auth (Web app đã đăng ký riêng trong Firebase project `jankara-e2e-test`).
- Trang public (browse giải đấu/team/match) nên dùng SSR/ISR cho SEO — đây là lý do chính chọn Next.js thay vì Flutter Web.
- Dùng skill `add-web-page` để scaffold page/feature mới.
- **shadcn/ui là design system chính từ 2026-08-15** (`apps/web/components.json`, đã setup) — `packages/ui` cũ (Button/Card/Badge/Container/Pagination) đang được migrate dần sang shadcn, KHÔNG rewrite 1 lần. Component/trang MỚI luôn dùng shadcn (`npx shadcn@latest add <component>`), kể cả khi `packages/ui` đã có bản tương đương. Khi tiện sửa 1 trang đang dùng `packages/ui` cũ, đổi luôn sang shadcn nếu không tốn nhiều effort ngoài scope; không thì để nguyên, đừng ép migrate riêng 1 task không liên quan. Icon dùng `lucide-react`. `aliases.utils` trỏ `@football-app/ui` để dùng chung `cn` cũ — nhưng lệnh `shadcn add <component>` tự lỗi vì `packages/ui/package.json` thiếu `exports` field, phải tạm trả `aliases.utils` về `@/lib/utils` lúc chạy `add` rồi sửa tay import sau (chi tiết đầy đủ ở `.claude/agents/web-dev.md`). App chưa có `next-themes`/toggle `.dark` — `dark:` đang chạy theo system preference; nếu `shadcn init`/`add` tự thêm `@custom-variant dark (&:is(.dark *));` vào `globals.css` thì phải xoá, không sẽ tắt im lặng toàn bộ dark mode hiện có.

### Admin (`apps/web/src/app/admin/*`, ROADMAP Phase 4)
- **Không phải app/port riêng** — sống chung `apps/web` (đã cân nhắc và bỏ 1 bản `apps/admin` scaffold độc lập trước đó), chỉ khác ở route `/admin/login`. `ConditionalWebChrome` (`apps/web/src/components/ConditionalWebChrome.tsx`) ẩn `NavBar`/`PushNotificationListener` công khai khi path bắt đầu `/admin` — root layout (`app/layout.tsx`) vẫn 1 Server Component duy nhất, KHÔNG tách route-group 2 root layout (đổi lại đơn giản hơn, không phải di chuyển mọi trang cũ).
- **Auth hoàn toàn tách biệt khỏi Firebase** (khác mọi nơi khác trong app) — username/password thật, bảng `AdminUser` riêng (`username` + bcrypt `passwordHash`), JWT tự ký (`apps/api/src/middleware/admin-auth.ts`'s `requireAdminSession`, `ADMIN_JWT_SECRET` env, hạn 7 ngày). `AdminAuthProvider`/`useAdminAuth()` (`apps/web/src/lib/admin-auth-context.tsx`) lưu token ở `localStorage` — biết đây là tradeoff so với httpOnly cookie (rủi ro XSS), chấp nhận được cho tool nội bộ quy mô nhỏ. KHÔNG dùng `User`/`firebaseUid`/`requireAuth` — admin không phải end-user (không favorites/notifications/search history).
- **Không có flow tự đăng ký/cấp quyền admin qua UI** — tạo (hoặc reset password) admin DUY NHẤT qua CLI: `pnpm --filter @football-app/api create-admin <username> <password>` (`apps/api/src/scripts/create-admin.ts`, upsert theo username).
- **CRUD đã build cho Competition/Season/Team/Player/Stadium/Coach/Referee** — 1 khung chung tái dùng (`ResourceTable`/`ResourceFormDialog`/`AdminResourcePage`, `apps/web/src/components/admin/`), mỗi trang chỉ khai báo columns/fields. Backend `POST`/`PATCH` (+ `search`) trên route file tương ứng, `requireAdminSession`. KHÔNG có Delete cho model có `onDelete: Cascade` sâu (Competition/Season/Team/Player) — Prisma Studio vẫn là escape hatch xoá thật.
- **`Match`**: sửa tỉ số/trạng thái/lịch (`PATCH /matches/:id`) + set tay `LiveMatchState` (`PUT /matches/:id/live`, upsert) qua 1 trang riêng (không dùng khung CRUD chung — 1 match sửa 2 endpoint khác nhau).
- **`AppConfig`** (feature flags): trang riêng (không dùng khung CRUD chung — `key` là primary key admin tự đặt, không phải cuid server sinh như model khác), value JSON sửa qua textarea.
- **`NotificationLog`**: trang read-only, lọc theo userId/status/channel.
- Chưa làm (optional, không bắt buộc theo exit criteria): xem danh sách `User` + favorites.

### Mobile (`apps/mobile`) — tạm pause, quy ước vẫn giữ cho khi resume
- Feature mới → folder riêng trong `lib/features/<feature>/` (theo mẫu `lib/features/health/`), gồm 1 Riverpod provider gọi qua `dioProvider` + 1 screen.
- Gọi API qua `dioProvider` (`lib/core/network/dio_client.dart`), không tạo `Dio()` instance riêng lẻ trong widget.
- Route mới → thêm vào `lib/core/router/app_router.dart` (GoRouter), không dùng `Navigator.push` trực tiếp trừ dialog/bottom sheet cục bộ.
- Dùng skill `add-mobile-feature` để scaffold feature mới.

### Authentication (Firebase Auth)
- Mobile: `lib/features/auth/auth_provider.dart` (`AuthController` — Google + Phone) và `auth_screen.dart`, đã wire vào router (`/auth`), có nút "Đăng nhập" ở `HealthScreen`. **Đã verify**: mở được màn Google sign-in thật trên iOS Simulator.
- iOS cần thêm `GIDClientID` + URL scheme (`CFBundleURLTypes`) vào `ios/Runner/Info.plist` — **`flutterfire configure` KHÔNG tự làm bước này**, phải lấy `CLIENT_ID`/`REVERSED_CLIENT_ID` từ `GoogleService-Info.plist` rồi thêm tay. Nếu thiếu, lỗi runtime: `PlatformException(google_sign_in, No active configuration...)`.
- Nếu enable thêm provider (Facebook, v.v.) trong Firebase Console SAU KHI đã chạy `flutterfire configure` lần đầu → phải chạy lại `flutterfire configure` để tải `GoogleService-Info.plist`/`google-services.json` mới (file cũ thiếu `CLIENT_ID` cho provider mới enable).
- Web: Web app đã đăng ký trong `jankara-e2e-test` qua `firebase apps:create WEB` (app id `1:264468798864:web:165e6c75fad5e45e07e715`). Firebase JS SDK ở `apps/web/src/lib/firebase.ts`, config qua `NEXT_PUBLIC_FIREBASE_*` trong `apps/web/.env.local` (gitignored, cùng lý do với mobile — xem "### Secrets & credentials"; lấy lại bằng `firebase apps:sdkconfig WEB <app-id> --project jankara-e2e-test`, xem `.env.example`). Auth context (Google popup + Facebook popup + Phone 2-step) ở `apps/web/src/lib/auth-context.tsx`, UI ở `apps/web/src/app/auth/page.tsx` + `AuthStatus` trong NavBar.
- Dev local **mặc định** dùng Firebase Auth Emulator qua `connectAuthEmulator` (guard `NODE_ENV === "development"`) — đã verify thật token do emulator cấp có `aud`/`iss` khớp `demo-football-app` (project giả emulator dùng, không phải `jankara-e2e-test`), đúng với `FIREBASE_PROJECT_ID` mặc định của `apps/api`, nên web + api tương thích khi cùng chạy qua Docker emulator.
- **Test bằng tài khoản Google/Facebook thật** (emulator chỉ nhận fake account tự tạo qua UI của nó, không nối được Google/Facebook thật): set `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false` trong `apps/web/.env.local` để `apps/web` bỏ qua emulator, nối thẳng `jankara-e2e-test` — PHẢI đổi `apps/api` theo cùng lúc (bỏ `FIREBASE_AUTH_EMULATOR_HOST`, set `FIREBASE_PROJECT_ID=jankara-e2e-test`), không thì `requireAuth` verify token thất bại (token thật có `aud`/`iss` khớp `jankara-e2e-test`, không khớp `demo-football-app` mà emulator-mode `apps/api` đang chờ). Chạy `apps/api` local (không qua Docker) khi cần test kiểu này — xem "## apps/api" trong README.
- Backend verify token qua `requireAuth` middleware (`apps/api/src/middleware/auth.ts`) dùng `firebase-admin` — chạy qua `pnpm docker:up` đã tự set `FIREBASE_AUTH_EMULATOR_HOST=firebase-emulator:9099` (xem "### Docker"), không cần project thật để test local; set `FIREBASE_PROJECT_ID`/`FIREBASE_SERVICE_ACCOUNT` trong `.env` khi cần verify token thật từ `jankara-e2e-test`. Dùng chung cho web + mobile.
- `requireAuth` KHÔNG set raw Firebase UID vào context. Sau `verifyIdToken`, nó resolve-or-create `User` row nội bộ theo `User.firebaseUid` (just-in-time provisioning — chưa có flow signup/profile riêng ở Phase 1) rồi `c.set("userId", internalUser.id)`. Vì vậy `c.get("userId")` trong route là `User.id` (cuid) FK-safe, dùng trực tiếp cho query Prisma (ví dụ `FavoriteTeam.userId`/`FavoritePlayer.userId`) — không phải raw Firebase UID. `User.email` là optional (`String?`) vì user đăng nhập bằng phone không có email claim.
- **Facebook login (web)**: code đã wire (`signInWithFacebook` trong `auth-context.tsx`, nút trong `auth/page.tsx`), nhưng cần enable tay ở Firebase Console (Authentication → Sign-in method → Facebook, nhập App ID + App Secret từ developers.facebook.com) + whitelist redirect URI `https://jankara-e2e-test.firebaseapp.com/__/auth/handler` trong cấu hình OAuth của Facebook App đó — không có CLI cho bước này. Chưa enable → lỗi `auth/operation-not-allowed` khi bấm nút. Mobile chưa có Facebook (xem note ở trên, chưa cần tới).
- **Web Push notification (Phase 2 Bước 3, FCM)** — **verify thật 2026-08-17: nhận được push thật trên browser**, sau khi fix 5 bug thật (chi tiết đầy đủ ở [ROADMAP.md § Phase 2 Bước 3](docs/architecture/ROADMAP.md#phase-2--real-time--notifications-size-l)):
  - Service worker `/firebase-messaging-sw.js` KHÔNG phải file tĩnh trong `public/` — đó là 1 Route Handler (`app/firebase-messaging-sw.js/route.ts`) đọc `process.env.NEXT_PUBLIC_FIREBASE_*` server-side lúc request và trả JS content — không cần copy tay giá trị Firebase config vào file nào cả, tự động đúng theo `.env.local`/`.env` đang chạy. Chỉ tự hiện notification khi KHÔNG tab nào của app đang focus.
  - **Tab đang mở/focus (foreground) KHÔNG tự hiện notification** — đây là hành vi thật của FCM Web (khác biệt quan trọng, dễ tưởng nhầm là bug), phải tự code `onMessage()` + `new Notification()` tay ở phía client (`listenForForegroundMessages()` trong `lib/push-notifications.ts`, mount qua `<PushNotificationListener />` toàn app trong `layout.tsx`) — service worker's `onBackgroundMessage` không cover case này.
  - Thiếu `NEXT_PUBLIC_FIREBASE_VAPID_KEY` (Firebase Console → Project Settings → Cloud Messaging → Web configuration → Generate key pair) → `getToken()` lỗi khi bấm nút, không chặn build/typecheck.
  - Thiếu `FIREBASE_SERVICE_ACCOUNT` hợp lệ ở `apps/api` (env, xem "### Authentication" ở trên) → `sendEachForMulticast` lỗi thật `"Could not load the default credentials"` (chỉ `FIREBASE_PROJECT_ID` không đủ để GỬI FCM — khác với `verifyIdToken` chỉ cần `projectId`) — đã catch, ghi `NotificationLog` status `FAILED`, không crash server, nhưng silent nếu không chủ động check bảng này.
  - `apps/api/src/realtime/redis-subscriber.ts`'s `subscribeChannel()` (dùng bởi `goal-notifier.ts`) phải đợi event Redis `"ready"` trước khi subscribe nếu client chưa kết nối xong — gọi ngay lúc boot (trước khi ioredis với `lazyConnect: false` kết nối xong) từng fail 100% (`enableOfflineQueue: false` không buffer lệnh) khiến subscriber không bao giờ nhận message, không throw ra ngoài nên dễ tưởng đã hoạt động.
  - Trạng thái nút "Bật thông báo bàn thắng" ở `/favorites` phải tự check lại khi mount (`GET /devices` + so khớp `getToken()` hiện tại) — không chỉ dựa vào state trong session, nếu không reload trang sẽ mất trạng thái "đã bật" dù backend vẫn còn device. `DELETE /devices/:id` để tắt.
  - **macOS có thể chặn notification của Chrome ở cấp hệ điều hành** (System Settings → Notifications → Google Chrome → "Allow Notifications") độc lập hoàn toàn với quyền "Allow" trong browser (`Notification.permission === "granted"` vẫn đúng, code chạy không lỗi, nhưng popup không hiện) — không phải bug code, luôn kiểm tra cả 2 lớp khi debug push không hiện trên macOS.
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
