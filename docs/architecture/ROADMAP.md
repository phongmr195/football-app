# Roadmap — Football App

Roadmap theo phase, sắp xếp theo **thứ tự phụ thuộc** (phase sau cần phase trước xong phần lõi), không theo lịch tuần/tháng cố định — vì chưa biết quy mô team. Mỗi phase có size tương đối (S/M/L/XL) để bạn tự quy đổi theo velocity thực tế của team. Điều chỉnh lại nếu team size/deadline cụ thể khác giả định.

**Giả định:** team nhỏ (~1-3 người, có thể kiêm nhiệm web + backend), làm bán thời gian hoặc song song nhiều task. Nếu team lớn hơn, các track (Web / Backend / Infra) trong cùng phase có thể chạy song song thay vì tuần tự.

> **Pivot (2026-08-07):** client chính chuyển từ Mobile (Flutter) sang **Web (Next.js)**. `apps/mobile` tạm pause — code giữ nguyên, không xoá. Từ Phase 1 trở đi, mục "Mobile" trong các phase cũ được đổi thành "Web". Xem chi tiết lý do ở [PROJECT_PLAN.md § 1 Pivot](./PROJECT_PLAN.md#pivot-web-trước-mobile-tạm-pause-2026-08-07). Trạng thái mobile lúc pause: xem [§ Mobile — tạm pause](#mobile--tạm-pause-trạng-thái-tại-thời-điểm-pause) ở cuối file.

---

## Phase 0 — Foundation (Size: M)

**Mục tiêu:** có skeleton chạy được end-to-end (rỗng nhưng thông mạch), CI/CD hoạt động, không còn quyết định kiến trúc treo.

**Deliverables:**
- [x] Monorepo setup: Turborepo config, `packages/config` (eslint/tsconfig chung)
- [x] `packages/database`: Prisma schema baseline (toàn bộ bảng ở [PROJECT_PLAN.md § 4](./PROJECT_PLAN.md#4-database-design-theo-module-đã-cập-nhật)) — **migration đầu tiên đã tạo + apply thật** (`20260807032808_init`) vào Postgres chạy qua Docker (2026-08-07)
- [x] **(mới)** Docker: `docker-compose.yml` (data: Postgres+Redis, log: Dozzle, api, sync-worker) + `docker-compose.test.yml` (test cô lập) + Dockerfile production cho `apps/api`/`apps/sync-worker` — verify thật: build image, migration chạy vào container, health-check qua container, test suite pass trong container, sync-worker chạy đúng tới bước gọi API-Football (thiếu key thật)
- [x] `apps/api`: Hono skeleton, health-check endpoint, Firebase Admin auth middleware (code xong, verify health-check thật; middleware chưa test với Firebase project thật)
- [x] `apps/mobile` (tạm pause sau bước này): Flutter skeleton, GoRouter, Riverpod, Dio, Firebase Auth (Google+Phone) — verify thật trên iOS Simulator + Android build. Xem chi tiết ở mục Mobile pause cuối file.
- [x] Firebase project (`jankara-e2e-test`, dùng chung với project khác): tạo/login, bật Google+Phone provider, `flutterfire configure` cho mobile — **Web app chưa đăng ký trong Firebase project** (cần làm ở Phase 1 Web)
- [x] `infrastructure/terraform`: baseline (VPC, Aurora instance nhỏ, S3 bucket) — đã bỏ Cognito (không cần AWS cho auth nữa); **vẫn thiếu resource API Gateway REST**, và toàn bộ **chưa `apply`** (thiếu AWS credentials hợp lệ)
- [x] CI: lint + test + build chạy trên PR (`github-actions`) — verified: PR đã merge, CI xanh
- [x] Xác nhận giá/rate-limit thực tế của API-Football, tạo account + API key test — **xong**: account Free plan, **100 requests/ngày** (giới hạn thật, cần tính toán tần suất sync cho phù hợp ở Phase 2 adaptive polling), key lưu trong `.env` (gitignored, KHÔNG commit)
- [ ] **(mới)** `apps/web`: scaffold Next.js — chưa làm, xem Phase 1

**Exit criteria:** đăng ký/login từ app thật, gọi được 1 API rỗng, deploy tự động qua CI. → **Chưa đạt đầy đủ cho Web** (login/API đã verify được cho mobile trước khi pause; cần lặp lại phần Web app registration + đăng nhập thật trên web ở Phase 1). CI mới validate, chưa có bước deploy.

---

## Phase 1 — MVP Core: Data & Browse (Size: L)

**Mục tiêu:** người dùng browse được dữ liệu bóng đá thật (không real-time, không AI) — thay thế phần "xem thông tin" cơ bản của Sofascore/FotMob.

**Backend/Data:**
- [x] `packages/data-provider`: canonical model + adapter API-Football — đã thêm `fetchCompetitions`/`fetchSeasons`/`fetchTeams`/`fetchPlayers`/`fetchMatches`, **verify thật với API key thật** (Premier League id=39, season 2023 — đối chiếu đúng bảng xếp hạng thật Man City 91đ/Arsenal 89đ). Phát hiện + fix 2 bug qua verify: (1) `/standings` lồng sâu hơn dự đoán (`response[0].league.standings` là mảng CÁC NHÓM, không phải mảng hàng trực tiếp — đã fix bằng `.flat()`), (2) `/players` phân trang thật (~3-4 trang/squad) — đã fix loop hết `paging.total`. `mapMatchEvent` (`/fixtures/events`) còn chưa verify (chưa có trận để test).
- [x] `apps/sync-worker`: `sync-catalog.ts` (syncCompetitions → syncSeasons → syncTeams → syncPlayers → syncStandings/syncMatches, đúng thứ tự phụ thuộc) + `sync-all.ts` orchestrator (cron đơn giản, đọc `SYNC_COMPETITION_IDS`/`SYNC_SEASON_YEAR` từ env) — verify thật bằng mock adapter + Postgres Docker (5 test pass: upsert idempotent, FK resolve, throw đúng khi thiếu dependency, skip team lạ)
- [x] API: `/competitions`, `/teams` (+ `/teams/:id/players`), `/players`, `/matches` (list có filter `competitionId`/`status`, detail), `/standings?seasonId=`, `/statistics/teams|players/:id?seasonId=` — verify thật qua curl với data seed (không phải chỉ build pass)
- [x] Admin tool tối giản để sửa tay dữ liệu sai từ provider — **dùng Prisma Studio có sẵn** (`pnpm db:studio`), verify chạy thật (mở UI, HTTP 200) — không cần code riêng, đủ cho nhu cầu list/edit tay ở Phase 1. Nâng cấp thành `apps/admin` thật nếu sau này cần (ROADMAP Phase 6).
- [x] `sync-all.ts` (orchestrator dùng `SYNC_COMPETITION_IDS`) đã chạy full end-to-end với key thật cho competition 39/season 2023 — competitions(1239)/teams(20)/players(1022)/standings(20)/matches(380) đều đã vào DB đúng (2 bug thật gặp giữa đường đã fix, xem 2 bullet dưới).
- [x] **Quota thật đo được** (header response, 2026-08): **10 request/phút** VÀ **100 request/ngày** (Free plan). Đã fix bug throttle thật: adapter cũ gọi request liên tục không giới hạn → dính `429` giữa chừng khi sync nhiều team (`packages/data-provider/src/rate-limiter.ts`, sliding-window 8 req/phút). Full sync 1 giải 20 team tốn **~85-95 request** (players chiếm phần lớn — 1093 lượt fetch cho 20 team, dedup DB xuống 1022 player vì có người chuyển team giữa mùa) — gần như dùng hết quota ngày, không đủ chạy tiếp `fetchMatches` trong cùng ngày nếu đã test nhiều trước đó. Kết luận: 1 giải/lần chạy/ngày là giới hạn thực tế của Free plan.
- [x] **Bug thật quan trọng hơn, đã fix**: API-Football báo lỗi hết quota/param sai bằng **HTTP 200 kèm `errors` có nội dung trong body**, KHÔNG phải mã lỗi HTTP — code cũ chỉ check `res.ok`/429 nên coi lỗi này là "thành công" với response rỗng. Hậu quả thật đã xảy ra: `fetchMatches` trả về 0 match một cách âm thầm khi hết quota giữa lúc chạy `sync-all` thật (competitions/teams/players/standings đã sync đúng vào DB, matches=0 vì lỗi này). Đã fix: `request()` giờ throw nếu `body.errors` non-empty dù HTTP 200. Verify bằng test mock (`api-football.adapter.test.ts`), không cần gọi API thật.
- [x] **Retry `syncMatches` cho competition 39/season 2023** (2026-08-13, key mới): thành công, **380 matches** (đúng số trận Premier League 1 mùa: 20 team × 38 vòng), tất cả status `FINISHED`, không skip trận nào — verify qua DB. Data Phase 1 cho competition 39/season 2023 giờ đầy đủ: competitions(1239)/teams(20)/players(1022)/standings(20)/matches(380). Lưu ý phụ: key API-Football trước đó (dùng để retry lần đầu) bị tài khoản **suspended** (`errors.access` trong body, HTTP 200) — chính là loại lỗi mà bug fix HTTP-200-errors ở trên bắt được, xác nhận fix hoạt động đúng với nhiều loại lỗi, không chỉ hết quota ngày.
- [x] **(mới, 2026-08-13) Đổi provider mặc định sang football-data.org** — nguyên nhân: API-Football free tier tiếp tục **suspend 3 key khác nhau** (không phải lỗi 1 lần), quota 100 request/ngày quá chật cho sync thường xuyên. `football-data.org` free tier ("Free Forever", verify thật qua `/status`): **10 request/phút, KHÔNG giới hạn/ngày**, phủ **13 giải** (verify thật qua `GET /competitions`): Premier League, Championship, La Liga, Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, Brasileirão, Champions League, European Championship, Copa Libertadores, World Cup — đủ scope MVP "top 10-15 giải" đã định). Thêm `FootballDataAdapter` (`packages/data-provider/src/adapters/football-data.adapter.ts`) implement cùng `DataProviderAdapter` interface, KHÔNG sửa `ApiFootballAdapter` (vẫn giữ, chọn qua `DATA_PROVIDER=api-football`). `apps/sync-worker` chọn adapter qua `createAdapter()` (`src/provider.ts`) đọc env `DATA_PROVIDER`, **mặc định `"football-data"`**.
- [x] **Verify thật FootballDataAdapter** — sync thật Premier League (`competition id=2021`) season 2023 qua Postgres Docker: `{ teams: 20, players: 640, standings: 20, matches: 380 }`, đối chiếu đúng bảng xếp hạng đã biết trước (Man City vị trí 1, **91 điểm**, giống số liệu từ API-Football) — additive, không đụng data API-Football cũ (externalRef khác `provider`). Không gặp 429 nào (rate limiter 8 req/phút đủ margin dưới giới hạn thật 10/phút). Phát hiện + fix 1 bug thật qua sync thật: `GET /v4/teams/{id}` trả **403** cho team đã rời khỏi TOÀN BỘ 13 giải free-tier ở season hiện tại (ví dụ Luton Town id=389, hiện chỉ đá League One) dù season lịch sử được hỏi (2023, khi còn đá Premier League) nằm trong phạm vi — nghĩa là football-data.org gate quyền truy cập `/teams/{id}` theo giải đang đá BÂY GIỜ, không theo season query param. Fix: `fetchPlayers` bắt riêng lỗi 403 này, trả `[]` + log warn thay vì throw, không chặn cả job sync. Quirk khác đã verify thật (khác API-Football): lỗi trả về bằng HTTP status code thật (400/403) kèm body `{message, errorCode}`, KHÔNG có kiểu "HTTP 200 + errors trong body"; `type` competition chỉ có `LEAGUE`/`CUP` (không có "INTERNATIONAL" riêng — European Championship vẫn map `CUP` vì area code giống Champions League, giới hạn đã biết); standings trả nhiều nhóm `TOTAL`/`HOME`/`AWAY`, chỉ lấy nhóm `TOTAL`; free tier không expose match events chi tiết (`fetchMatchEvents` throw rõ ràng).

**Web (client chính — đổi từ Mobile theo pivot):**
- [x] Scaffold `apps/web` (Next.js) + `packages/ui` baseline — Next.js 16 App Router (`--typescript --app --tailwind --src-dir`), `packages/ui` (Button/Card/Badge/Container, `tsc`-built, `react` peerDependency), wired qua `@football-app/ui`.
- [x] Đăng ký Web app trong Firebase project, wire Firebase Auth (Google/Phone) cho web — `firebase apps:create WEB` cho `jankara-e2e-test`, Firebase JS SDK (`apps/web/src/lib/firebase.ts`), `AuthProvider`/`useAuth()` (Google popup + Phone 2 bước: gửi mã → xác nhận), trang `/auth` + trạng thái đăng nhập trong NavBar. Dev local nối Auth Emulator (`connectAuthEmulator`, chỉ khi `NODE_ENV=development`) — verify thật bằng cách tự chạy Firebase SDK thật chống lại emulator (không chỉ build pass): `onAuthStateChanged` bắt đúng user, decode ID token xác nhận `aud`/`iss` khớp project giả `demo-football-app` mà `apps/api` đang dùng làm default khi verify token qua emulator → web + api tương thích khi chạy cùng Docker. Đã thêm `apiGetClient`/`apiMutateClient` (client-side, đính `Authorization: Bearer <idToken>`) trong `api-client.ts`, tách khỏi `apiGet` (server-only, không auth) — chuẩn bị cho favorites (mục tiếp theo, endpoint đầu tiên cần `requireAuth`). **Verify thật đăng nhập qua browser (2026-08-15)**: đăng nhập Google popup và Facebook popup thành công trên browser thật (tài khoản thật, không phải emulator) — xác nhận toàn bộ flow OAuth hoạt động đúng, không chỉ dừng ở bước mở popup.
- [x] Trang: danh sách giải đấu, bảng xếp hạng, chi tiết trận đấu (đã kết thúc/sắp diễn ra), chi tiết team/player — `/competitions`, `/competitions/[id]`, `/standings/[seasonId]`, `/matches` (filter `competitionId`/`status`), `/matches/[id]`, `/teams/[id]` (roster phân trang), `/players/[id]`. Tất cả Server Component + ISR (`revalidate` theo độ "nóng" data — catalog 3600s, standings/matches 300-1800s). Verify thật bằng data đã sync (Premier League/2023: Man City 91đ đúng vị trí 1, Burnley 0-3 Man City render đúng), không chỉ build pass.
- [x] `favorite_teams`/`favorite_players`: wire UI + API `/favorites` — backend: `GET/POST/DELETE /favorites/teams|players` sau `requireAuth` (feature đầu tiên cần auth thật, dẫn tới fix `requireAuth` resolve internal `User.id` thay vì raw Firebase UID + rename `User.cognitoSub`→`firebaseUid` + `email` thành optional cho user đăng nhập bằng phone — xem chi tiết trong git log PR "Add /favorites API"). Frontend: `FavoriteButton` (client island trong `/teams/[id]`, `/players/[id]`) + trang `/favorites`. Verify thật bằng token thật từ Firebase Auth Emulator (không chỉ typecheck): auto-provision user, favorite/unfavorite idempotent, 401 khi thiếu token, 404 khi id sai.
- [~] Caching: SSR/ISR của Next.js cho trang public — **đã làm đầy đủ** (mọi trang browse dùng `revalidate`). Client cache (React Query hoặc tương đương) cho phần tương tác (favorites) — **chưa làm**: hiện dùng `useState`/`useEffect` fetch thô, đúng nhưng không dedupe/cache giữa `FavoriteButton` và trang `/favorites` (mỗi lần mount đều fetch lại). Đủ cho exit criteria Phase 1 (favorite/unfavorite hoạt động đúng), nhưng nếu cần polish thêm thì đây là việc còn lại — cân nhắc thêm React Query nếu muốn dedupe/cache thật.

**Exit criteria:** xem được lịch thi đấu, kết quả, bảng xếp hạng, follow được team/player yêu thích — hoàn toàn bằng dữ liệu thật, đăng nhập Firebase Auth thật trên web.

---

## Phase 2 — Real-time & Notifications (Size: L)

**Mục tiêu:** trải nghiệm "theo dõi thời gian thực" — điểm khác biệt cốt lõi so với việc chỉ xem kết quả tĩnh.

**Bước 1 (REST polling trước — ra sản phẩm sớm):**
- [ ] `live_match_state` table + Redis cache
- [ ] `GET /matches/live`, `GET /matches/{id}/live`, `GET /matches/{id}/events?since_seq`
- [ ] Web: polling ngắn (2-3s) khi vào trang live match — đủ để demo/dùng thật

**Bước 2 (nâng cấp lên WebSocket thật):**
- [ ] API Gateway WebSocket + Lambda handlers (`$connect`/`$disconnect`/subscribe)
- [ ] `ws_connections` (DynamoDB)
- [ ] Web: chuyển từ polling sang WebSocket API của browser, giữ REST làm fallback/catch-up khi reconnect

**Bước 3 (thông báo khi không mở app):**
- [ ] SNS fan-out "match-updates" → Lambda fcm-push (web: Web Push qua FCM), nối với `notification_settings`
- [ ] `notifications`/`notification_logs` wiring

**Bước 4 (tối ưu chi phí ingestion — có thể làm sau, không chặn release):**
- [ ] EventBridge Scheduler + Step Functions thay cron cố định cho sync-worker (adaptive polling theo trận live)

**Exit criteria:** mở web đúng lúc trận đang diễn ra, thấy tỉ số/event cập nhật không cần refresh tay; nhận được push khi team yêu thích ghi bàn.

---

## Phase 3 — Search & Deeper Stats (Size: M)

**Mục tiêu:** tính năng tìm kiếm và thống kê chuyên sâu — cạnh tranh trực tiếp với Sofascore ở phần "chuyên sâu".

- [ ] `/search` dùng Postgres full-text search (chưa cần OpenSearch — xem [PROJECT_PLAN.md § 7.1](./PROJECT_PLAN.md#71-chiến-lược-costcomplexity-theo-phase-nguyên-tắc-chung))
- [ ] `search_history`
- [ ] `top_scorers`, `top_assists`, `clean_sheets` — tính toán từ dữ liệu match đã có (job tổng hợp định kỳ)
- [ ] Player/team statistics chi tiết hơn (so sánh cơ bản giữa 2 cầu thủ — nền cho tính năng AI compare ở Phase 4)
- [ ] `match_lineups`, `formations`, `player_ratings`, `team_ratings`, `commentaries` — hoàn thiện trang chi tiết trận (web)

**Exit criteria:** tìm được team/player nhanh, xem được top scorer/assist theo giải, chi tiết trận đầy đủ (lineup, formation, rating) trên web.

---

## Phase 4 — AI Features (Size: L)

**Mục tiêu:** điểm khác biệt chính của app so với đối thủ.

- [ ] Bedrock setup + `ai_usage_logs` (cap usage/user NGAY từ đầu, tránh chi phí vượt kiểm soát)
- [ ] `ai_match_summary`: tự sinh tóm tắt sau khi trận kết thúc (trigger async từ SNS fan-out có sẵn ở Phase 2, không block API)
- [ ] `ai_player_summary`, tính năng so sánh cầu thủ bằng AI (dựa trên statistics đã có ở Phase 3)
- [ ] Chat AI: `chat_history`, `prompt_templates`, embeddings qua Titan + pgvector (RAG trên commentary/summary đã sinh ra)
- [ ] Web: trang chat, trang so sánh cầu thủ có AI insight

**Exit criteria:** đọc được tóm tắt trận đấu do AI viết, chat hỏi được về trận/cầu thủ, so sánh 2 cầu thủ có nhận xét AI trên web — với chi phí có kiểm soát (usage cap hoạt động).

---

## Phase 5 — Hardening & Launch (Size: M)

**Mục tiêu:** sẵn sàng phát hành công khai.

- [ ] Security review: WAF, rate limiting, audit Firebase Auth config (provider settings, App Check), kiểm tra ToS API-Football về redistribute dữ liệu
- [ ] Performance: load test API tại thời điểm nhiều trận live cùng lúc (giờ vàng cuối tuần); Lighthouse/Core Web Vitals audit cho web
- [ ] Observability đầy đủ: CloudWatch dashboards, Sentry cho web, alerting chi phí (Bedrock/API-Football/Aurora)
- [ ] Deploy production: `apps/web` lên hosting thật (Vercel hoặc CloudFront+S3), domain + SSL
- [ ] `feature_flags`/`app_config` hoạt động để kill-switch tính năng lỗi mà không cần release mới

**Exit criteria:** web live trên domain thật, có dashboard theo dõi chi phí + lỗi, có cơ chế tắt tính năng khẩn cấp.

*(App Store/Play Store submission dời sang khi resume mobile — xem mục Mobile pause.)*

---

## Phase 6 — Post-launch Growth (Size: XL, mở — làm theo feedback thật)

Không chốt chi tiết trước launch vì phụ thuộc feedback người dùng thật. Các hướng dự kiến:
- **Resume `apps/mobile`** — ưu tiên cao nếu web đã có traction, vì backend/data/AI đã sẵn, chỉ cần build lại UI (Firebase Auth mobile đã xong từ trước khi pause)
- Personalization sâu hơn (feed theo hành vi xem)
- `apps/admin` đầy đủ (nếu tool tối giản ở Phase 1 không còn đủ) — dùng chung `packages/ui` với `apps/web`
- Mở rộng coverage giải đấu / nâng cấp data provider (Sportradar/Opta) nếu doanh thu cho phép
- Monetization: ads, subscription cho tính năng AI nâng cao
- Đa ngôn ngữ ngoài Việt/English nếu có nhu cầu thị trường

---

## Mobile — tạm pause (trạng thái tại thời điểm pause)

Ghi lại để resume không phải làm lại từ đầu. Ngày pause: 2026-08-07.

**Đã xong và verify thật:**
- Flutter skeleton (`flutter create`), Riverpod + GoRouter + Hive + Dio wire sẵn
- `lib/features/health/` — pattern mẫu cho feature (provider gọi Dio + screen)
- `lib/features/auth/` — `AuthController` (Google sign-in + Phone OTP qua Firebase Auth), `AuthScreen`, đã wire vào router (`/auth`)
- Firebase project `jankara-e2e-test`: `flutterfire configure` xong, `GoogleService-Info.plist`/`google-services.json` có sẵn, **đã thêm `GIDClientID` + URL scheme vào `ios/Runner/Info.plist`** (bước riêng ngoài `flutterfire configure`)
- iOS deployment target đã nâng 13.0→15.0 (`firebase_auth` yêu cầu) — sửa ở `Podfile` + `project.pbxproj`
- SPM (Swift Package Manager) đã tắt (`flutter config --no-enable-swift-package-manager`) — dùng CocoaPods, vì SPM gây treo build vô hạn trên máy dev
- Đăng nhập Google: **verify tới bước mở màn hình Google thật trên iOS Simulator** — chưa xác nhận hoàn tất toàn bộ flow (chưa login bằng tài khoản Google thật tới cùng) tại thời điểm pause

**Chưa làm (còn nguyên trong ROADMAP các phase trên, dưới tên "Mobile" nếu resume):**
- Toàn bộ Phase 1 trở đi (browse UI, real-time, search, AI, hardening) — chưa build cho mobile, chỉ có Phase 0 skeleton + auth
- Facebook sign-in — chưa thêm package (`flutter_facebook_auth`), cần tạo Facebook App riêng
- App Store/Play Store submission

**Khi resume:** đọc lại `CLAUDE.md § Mobile toolchain` trước (SPM tắt, ANDROID_HOME/JAVA_HOME, RVM ruby conflict với CocoaPods) — đây là các vấn đề máy-cụ-thể đã tốn nhiều thời gian debug, đừng lặp lại.

---

## Tổng quan phụ thuộc giữa các phase

```
Phase 0 (Foundation)
   │
   ▼
Phase 1 (Data & Browse — Web) ─────┐
   │                              │
   ▼                              │
Phase 2 (Real-time)               │
   │                              │
   ▼                              ▼
Phase 3 (Search & Stats) ──▶ Phase 4 (AI — cần statistics từ Phase 3
   │                              làm nền cho so sánh/summary)
   ▼                              │
Phase 5 (Hardening & Launch) ◀────┘
   │
   ▼
Phase 6 (Post-launch — bao gồm resume Mobile)
```

Phase 3 và Phase 4 có thể chạy **song song một phần** nếu team đủ người (1 track làm search/stats, 1 track làm AI infra) — chỉ cần đồng bộ ở điểm AI cần dữ liệu statistics làm input.
