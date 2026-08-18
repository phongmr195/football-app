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
- [x] Admin tool tối giản để sửa tay dữ liệu sai từ provider — **dùng Prisma Studio có sẵn** (`pnpm db:studio`), verify chạy thật (mở UI, HTTP 200) — không cần code riêng, đủ cho nhu cầu list/edit tay ở Phase 1. Nâng cấp thành `apps/admin` thật ở Phase 4 (xem bên dưới — đẩy sớm hơn "post-launch" trong plan gốc vì nhu cầu sửa data sai đã xuất hiện thật nhiều lần qua Phase 1-3, xem CLAUDE.md § Data provider).
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

**(2026-08-15) Quyết định: chỉ triển khai/test 100% local, không mở AWS account** — lý do chi phí (Aurora Serverless v2 tối thiểu ~$44/tháng compute dù 0 traffic, không nằm trong Always Free) + LocalStack bản free không hỗ trợ API Gateway (REST/WebSocket, chỉ có ở bản Pro trả phí) nên không giả lập được đúng AWS miễn phí. Vẫn build **full chức năng** đúng plan gốc (WebSocket real-time, push notification), nhưng tách logic nghiệp vụ qua 1 interface — giống hệt pattern `DataProviderAdapter` (`packages/data-provider`) đã dùng cho data provider: local dùng `ws` package (plain WebSocket server) + Redis Pub/Sub (Redis đã wire từ Bước 1) thay cho API Gateway WS + SNS; implementation AWS thật (API Gateway/Lambda/SNS/DynamoDB) là bản thứ 2 của cùng interface, làm khi thật sự cần deploy production. Bước 2/3 dưới đây viết lại theo hướng này.

**Bước 1 (REST polling trước — ra sản phẩm sớm):** ✅ **Xong (2026-08-15)**
- [x] `LiveMatchState`/`MatchEvent` (đã có sẵn trong schema từ trước, chưa dùng tới) + Redis cache (`GET /matches/live`, TTL 5s, fallback êm về Postgres nếu Redis down) — xem `apps/api/src/lib/redis.ts`
- [x] `GET /matches/live`, `GET /matches/:id/live`, `GET /matches/:id/events?since_seq` — `apps/api/src/routes/matches.ts`
- [x] sync-worker: polling loop nội bộ (`apps/sync-worker/src/poll-live-matches.ts`, `poll.ts`) mỗi 30s, không cần AWS/EventBridge — chạy qua `pnpm --filter sync-worker poll` hoặc `pnpm docker:worker:live`. Ghi cả `Match` + `LiveMatchState` trong 1 transaction (fix thêm bug thật: lookup match theo `externalRef` thiếu filter `provider`, cùng loại bug đã fix ở `sync-catalog.ts` 2026-08-14)
- [x] Web: `LiveMatchPanel` (client component) tự poll 2-3s trên `/matches/[id]`, độc lập với ISR cache của trang (không gate theo `match.status` server-render vì cache có thể cũ tới 30 phút) — `apps/web/src/components/LiveMatchPanel.tsx`, `apps/web/src/lib/use-live-match.ts`
- Verify thật: giả lập trận live qua Prisma Studio, curl 3 endpoint mới, xác nhận Redis cache thật có ghi (TTL) + fallback đúng khi Redis down, mở browser thật thấy panel tự cập nhật không cần F5.

**Bước 2 (nâng cấp lên WebSocket thật — local-first, xem quyết định ở trên):** ✅ **Xong (PR #31)**
- [x] Interface `RealtimeTransport` (`packages/realtime/src/publisher.interface.ts`) — `publish()`/`publishGoal()`, tách khỏi implementation cụ thể (Redis local vs AWS sau này)
- [x] Local: WebSocket server dùng package `ws` (`apps/api/src/realtime/ws-server.ts`), connection registry qua Redis (`connection-registry.ts`, có test riêng) thay `ws_connections` DynamoDB
- [ ] AWS (làm sau, khi thật sự deploy): API Gateway WebSocket + Lambda handlers (`$connect`/`$disconnect`/subscribe) + `ws_connections` (DynamoDB) — implementation thứ 2 của cùng interface, **chưa làm, đúng theo quyết định hoãn AWS ở trên**
- [x] Web: đã chuyển từ polling sang WebSocket thật (`apps/web/src/lib/use-live-match.ts` gọi `subscribeToMatch()` từ `lib/realtime-client.ts`), giữ 1 poll 45s làm safety-net (phòng socket chết không bắn `onclose`) + REST `/matches/:id/events?since_seq` làm catch-up — verify thật qua `LiveMatchPanel` trên `/matches/[id]`

**Bước 3 (thông báo khi không mở app — local-first):** ✅ **Xong, verify thật 2026-08-17 (PR #32 + fix thêm)**
- [x] Local: Redis Pub/Sub channel `goal-events` (`apps/api/src/realtime/goal-notifier.ts` + `redis-subscriber.ts`) → gọi FCM trực tiếp qua `firebase-admin/messaging`, nối với `notification_settings` (thiếu row = coi `goalAlerts: true`, đúng `@default`)
- [ ] AWS (làm sau): SNS fan-out "match-updates" → Lambda fcm-push — implementation thứ 2 của cùng interface fan-out, **chưa làm, đúng theo quyết định hoãn AWS**
- [x] `notifications`/`notification_logs` wiring — mỗi lần gửi ghi 1 `Notification` + 1 `NotificationLog`/token (status `SENT`/`FAILED`)
- **5 bug thật phát hiện + fix qua test thủ công thật (publish `goal-events` qua `redis-cli`, không phải unit test)**, xem chi tiết trong git log các commit tương ứng ngày 2026-08-17:
  1. `redis-subscriber.ts`: `subscribeChannel()` gọi `.subscribe()` ngay lúc boot, TRƯỚC KHI connection ioredis (`lazyConnect: false`) thật sự sẵn sàng — do `enableOfflineQueue: false` (chủ đích, fail-fast khi Redis down thật), lệnh SUBSCRIBE bị lỗi "Stream isn't writeable" và fail **100% số lần khởi động local** trước khi fix, khiến toàn bộ goal-notifier thành no-op im lặng (không throw, dễ tưởng nhầm đã hoạt động). Fix: đợi event `"ready"` nếu client chưa sẵn sàng.
  2. Schema drift thật: `schema.prisma` đã có `DevicePlatform.WEB` nhưng migration gốc (`20260807032808_init`) chỉ tạo enum Postgres với `IOS`/`ANDROID` — không có migration nào từng thêm `WEB` cho tới khi phát hiện qua lỗi `invalid input value for enum "DevicePlatform": "WEB"` lúc test `POST /devices` thật. Fix: migration `20260816152237_add_web_device_platform` (đã có sẵn trong PR #32 nhưng DB dev local chưa apply — bài học: `pnpm db:generate` không đủ, phải chạy `pnpm db:migrate`/`db:migrate:deploy` thật sau khi pull code mới có migration).
  3. `packages/realtime` chưa từng được build (`dist/` không tồn tại) dù đã link đúng qua pnpm workspace — `pnpm install` không tự build workspace package, phải chạy `pnpm --filter @football-app/realtime build` tay (hoặc qua turbo) sau khi thêm package mới.
  4. Frontend thiếu hẳn xử lý **foreground push** (tab đang mở/focus) — `firebase-messaging-sw.js`'s `onBackgroundMessage` chỉ tự hiện notification khi KHÔNG tab nào focus; code cũ cố ý chưa làm phần foreground (comment "not part of this piece"). Fix: thêm `listenForForegroundMessages()` (`onMessage()` + `new Notification()` tay) trong `lib/push-notifications.ts`, mount qua `<PushNotificationListener />` toàn app trong `layout.tsx`.
  5. UX thật: nút "Bật thông báo bàn thắng" ở `/favorites` không phản ánh đúng trạng thái đã lưu — reload trang sau khi đã bật vẫn hiện lại nút bật từ đầu, và không có cách tắt. Fix: thêm `GET /devices` + `DELETE /devices/:id`, trang tự kiểm tra device hiện có khi mount (`getToken()` lại + so khớp danh sách), hiện đúng nút "Tắt thông báo" khi đã bật.
  - Lưu ý ngoài code: macOS có thể chặn notification của Chrome ở **cấp hệ điều hành** (System Settings → Notifications → Google Chrome) độc lập với quyền "Allow" trong browser — không phải bug, cần bật tay khi test.

**Bước 4 (tối ưu chi phí ingestion — có thể làm sau, không chặn release):** ✅ **Xong (PR #32)**
- [x] Adaptive polling in-process (`apps/sync-worker/src/adaptive-interval.ts`, có test) — tight 15s khi có trận LIVE/HALFTIME hoặc SCHEDULED sắp kickoff trong 15 phút tới, idle 5 phút còn lại — không cần AWS
- [ ] AWS (chỉ khi cần scale thật): EventBridge Scheduler + Step Functions thay cho loop/logic in-process — **chưa làm, đúng theo quyết định hoãn AWS**

**Exit criteria:** mở web đúng lúc trận đang diễn ra, thấy tỉ số/event cập nhật không cần refresh tay; nhận được push khi team yêu thích ghi bàn. → **Đạt** (verify thật 2026-08-17: goal push nhận được trên browser thật, sau khi fix 5 bug ở trên). Phần AWS thật (API Gateway/SNS/EventBridge) vẫn hoãn theo quyết định 2026-08-15, làm khi thật sự cần deploy production.

---

## Phase 3 — Search & Deeper Stats (Size: M)

**Mục tiêu:** tính năng tìm kiếm và thống kê chuyên sâu — cạnh tranh trực tiếp với Sofascore ở phần "chuyên sâu".

- [x] `/search` dùng Postgres full-text search (`contains`/`ILIKE` v1 — đủ nhanh cho quy mô data hiện tại, chưa cần `tsvector`+GIN hay OpenSearch, xem [PROJECT_PLAN.md § 7.1](./PROJECT_PLAN.md#71-chiến-lược-costcomplexity-theo-phase-nguyên-tắc-chung)) — `apps/api/src/routes/search.ts`, `apps/web/src/app/search/page.tsx` + ô tìm kiếm trên `NavBar`
- [x] `search_history` — ghi 1 dòng/lượt search khi đã đăng nhập (ẩn danh bỏ qua, không có giá trị tra cứu lại) qua `tryResolveUserId()` (`apps/api/src/middleware/auth.ts`, biến thể không bắt buộc đăng nhập của `requireAuth`)
- [x] `top_scorers`, `top_assists`, `clean_sheets` — verify thật 2026-08-17, Premier League 2025/26: `FootballDataAdapter.fetchTopScorers()` (`GET /competitions/{id}/scorers?limit=100`, endpoint free tier thật, KHÔNG phải feature trả phí) trả cả `goals` lẫn `assists`/`playedMatches` trong 1 request — derive `TopScorer` (rank theo goals) + `TopAssist` (rank theo assists, lọc `assists=0`) từ CÙNG dữ liệu. `clean_sheets` tính thẳng từ `Match` đã sync (không gọi thêm provider). Cả 2 job (`syncTopScorers`/`syncTeamAggregates`, `apps/sync-worker/src/sync-catalog.ts`) chạy tự động trong `syncCompetitionSeason()`. **Giới hạn đã biết**: `TopAssist` chỉ derive từ top-100 GOALS, không phải bảng kiến tạo đầy đủ của giải — 1 tiền vệ ghi ít bàn nhưng kiến tạo nhiều có thể bị thiếu nếu không lọt top 100 scorers (football-data.org free tier không có endpoint assists riêng). `ApiFootballAdapter.fetchTopScorers()` chưa implement (throw rõ ràng, caller catch gracefully) — provider phụ, hiện đang bị suspend.
- [x] Player/team statistics chi tiết hơn — `PlayerStatistics.{appearances,goals,assists}` (từ scorers endpoint) + `TeamStatistics.{wins,draws,losses,goalsFor,goalsAgainst,cleanSheets}` (tính từ `Match`), hiện thẻ "Thống kê mùa giải gần nhất" trên `teams/[id]`/`players/[id]` (`GET /statistics/teams/:id`/`players/:id` không truyền `seasonId` → tự lấy mùa gần nhất có data). **Scoped down có chủ đích**: `yellowCards`/`redCards`/`minutesPlayed` giữ mặc định `0` của schema, KHÔNG hiện lên UI — cần dữ liệu match-event cấp cầu thủ mà provider hiện tại (football-data.org free tier) không có, xem mục dưới. So sánh cơ bản giữa 2 cầu thủ (nền cho AI compare Phase 5): **chưa làm**, để lại cho Phase 5 khi cần.
- [x] **(2026-08-18) `match_events`/`match_lineups`/`formations`/`player_ratings`/`match_statistics`** — giải quyết bằng scraper riêng thay vì chờ `api-football` unblock (bullet gốc ở trên vẫn đúng: 2 data provider chính thức KHÔNG có endpoint này ở free tier). `apps/scraper-sofascore` (Python, component đầu tiên ngoài Node/TS — xem CLAUDE.md § Scraper) dùng thư viện `soccerdata` để lấy dữ liệu từ Sofascore, pipeline 3 bước (Node sinh manifest → Python scrape+resolve ID → Node ingest qua Prisma). **Giới hạn có chủ đích của piece này**: chỉ Premier League, mùa giải 2025-2026, chạy tay/backfill (không tự động theo lịch); `commentaries` (bình luận dạng text) vẫn KHÔNG có nguồn (Sofascore trả structured events, không phải text commentary) — `Commentary` model vẫn chưa dùng tới. **Rủi ro kỹ thuật/ToS thật, đã cân nhắc và chấp nhận**: `soccerdata` bypass Cloudflare bằng cách giả mạo TLS fingerprint (JA3) của browser thật (`tls_requests` + native binary `bogdanfinn/tls-client`) — khác hẳn việc gọi API đối tác có ToS cho phép, có thể gãy bất cứ lúc nào nếu Sofascore đổi cơ chế chống bot. Verify thật 2026-08-18: chạy full pipeline trên 3 match Premier League thật, 49 event/111 lineup/87 rating/6 match-statistic ghi đúng vào DB, phát hiện+fix 1 bug thật (own-goal: Sofascore's `isHome` chỉ đội được lợi điểm, không phải đội cầu thủ ghi bàn).

**Exit criteria:** tìm được team/player nhanh ✅, xem được top scorer/assist theo giải ✅ (kèm sạch lưới), chi tiết trận (event/lineup/formation/rating/statistics) ✅ **cho Premier League mùa 2025-2026** (qua scraper, không phải 2 data provider chính) — commentary dạng text vẫn chưa có nguồn, giải/mùa khác chưa mở rộng.

---

## Phase 4 — Admin Panel (Size: M)

**Mục tiêu:** thay Prisma Studio bằng 1 tool nội bộ chuyên dụng để sửa data sai từ provider, quản lý feature flags, và debug notification — đẩy sớm hơn "post-launch" trong plan gốc (PROJECT_PLAN.md § 8) vì friction thật đã lặp lại nhiều lần qua Phase 1-3 (tên/logo sai từ provider, cần set tay `LiveMatchState` để test Phase 2, tra `NotificationLog` bằng SQL tay khi debug push Phase 2 Bước 3). Theo đúng nguyên tắc "chỉ thêm khi cần thật đo được" (PROJECT_PLAN.md § 7.1) — Prisma Studio đã đủ cho Phase 1-3, giờ mới đáng để build riêng.

- [x] **Admin access control** — quyết định cuối (đổi từ bản nháp đầu dùng `User.role`+Firebase): **hoàn toàn tách biệt khỏi Firebase** — bảng `AdminUser` riêng (`username` + bcrypt `passwordHash`, KHÔNG dùng chung với `User`/`firebaseUid`), JWT tự ký (`apps/api/src/middleware/admin-auth.ts`'s `requireAdminSession`, `ADMIN_JWT_SECRET` env, hạn 7 ngày). Lý do đổi: yêu cầu thật là đăng nhập username/password nội bộ, không phải Google/Facebook — xem `AdminUser` model trong schema.prisma cho lý do không tái dùng `User`. Verify thật: `POST /admin/login` đúng/sai password, `GET /admin/me` có/không/sai token — cả 4 case đều đúng status (200/401). **Chưa có flow tự cấp quyền admin qua UI** — admin đầu tiên (và mọi admin sau) được tạo qua CLI script, xem bullet script bên dưới.
- [x] `/admin/*` — **KHÔNG phải app/port riêng** (đổi từ bản nháp đầu `apps/admin` scaffold độc lập) — sống chung `apps/web`, cùng port, chỉ khác route `/admin/login`. `ConditionalWebChrome` (`apps/web/src/components/ConditionalWebChrome.tsx`) ẩn `NavBar`/`PushNotificationListener` công khai khi `pathname` bắt đầu bằng `/admin` — root layout vẫn là 1 Server Component duy nhất (không tách route-group 2 root layout, đổi lại đơn giản hơn: mọi trang cũ giữ nguyên chỗ, không phải di chuyển). `AdminAuthProvider`/`useAdminAuth()` (`apps/web/src/lib/admin-auth-context.tsx`, token lưu `localStorage`) + `AdminGate` (`apps/web/src/components/admin/AdminGate.tsx`) — bỏ qua chính `/admin/login`, redirect các route `/admin/*` khác về đó khi chưa đăng nhập, hiện sidebar (Giải đấu/Đội bóng/Cầu thủ/Trận đấu/Cấu hình/Nhật ký thông báo) khi đã xác nhận. Verify thật qua browser: `/admin` chưa đăng nhập → redirect `/admin/login`; trang công khai (`/`, `/competitions`) vẫn `NavBar` bình thường, không lẫn sidebar admin. `pnpm build` (turbo, root) verify sạch theo đúng cách đã dùng để tìm+fix bug CI build home-dashboard (xoá `.env.local`, dùng fake Firebase env vars của CI) — `/admin/*` không đụng Firebase nên không phụ thuộc các biến đó, nhưng vẫn build tĩnh (`○`) sạch cùng lúc với các trang công khai khác.
- [x] Script tạo admin user — `pnpm --filter @football-app/api create-admin <username> <password>` (`apps/api/src/scripts/create-admin.ts`), upsert theo username (chạy lại = reset password, không báo lỗi trùng) — cách duy nhất để có admin đầu tiên, không có flow tự đăng ký. Verify thật: chạy script, kiểm tra `admin_users.passwordHash` bắt đầu bằng `$2b$12$` (bcrypt thật, không phải plaintext) qua `psql`.
- [x] Nav sidebar (Giải đấu/Mùa giải/Đội bóng/Cầu thủ/Sân vận động/HLV/Trọng tài/Trận đấu/Cấu hình/Nhật ký thông báo) — mọi trang stub ban đầu đã được thay bằng trang thật (các bullet dưới).
- [x] CRUD `Competition`/`Season`/`Team`/`Player`/`Stadium`/`Coach`/`Referee` — 1 khung CRUD tái dùng chung (`ResourceTable`/`ResourceFormDialog`/`AdminResourcePage`, `apps/web/src/components/admin/`), mỗi trang chỉ khai báo columns/fields/mapping. Backend: `POST`/`PATCH` (+ `search` param cho list) trên chính route file có sẵn (`competitions.ts`/`teams.ts`/`players.ts`/`stadiums.ts`), route mới `coaches.ts`/`referees.ts`/`seasons.ts`, đều gate `requireAdminSession`. Validate qua Zod, chuỗi rỗng transform thành `null` (xoá field thật, không giữ `""`). **Không có DELETE** cho các model có `onDelete: Cascade` sâu (Competition/Season/Team/Player) — Prisma Studio vẫn là escape hatch có chủ đích cho xoá thật. Verify thật: tạo/sửa qua curl + browser, sửa `logoUrl` 1 Team thật rồi xác nhận `/teams/[id]` (trang public) hiển thị đúng giá trị mới ngay lập tức.
- [x] Xem/sửa `Match` (tỉ số, trạng thái, lịch) + set tay `LiveMatchState` — trang riêng (không dùng khung CRUD chung, vì 1 match cần sửa 2 thứ khác endpoint): `PATCH /matches/:id` (kickoffAt/status/homeScore/awayScore) + `PUT /matches/:id/live` (upsert `LiveMatchState`: status/minute/score/lastEventSeq), cả 2 `requireAdminSession`. List thêm `search` (tên đội) kết hợp đúng với `teamIds` filter có sẵn (gộp qua `AND`, tránh xung đột 2 điều kiện cùng dùng `OR`). Verify thật qua curl trên 1 match FINISHED thật (sửa tỉ số, upsert live state, xác nhận qua GET công khai, revert lại).
- [x] Trang quản lý `AppConfig` (feature flags) — `key` là primary key thật do admin tự đặt (không phải cuid server sinh như mọi model khác) nên trang này viết riêng, không ép vào khung CRUD chung; `value` (Json) sửa qua textarea JSON, parse/validate phía client trước khi gửi. `GET/POST/PATCH /config`, `requireAdminSession`.
- [x] Trang xem `NotificationLog` (lọc theo userId/status/channel, phân trang) — `GET /notification-logs` (join `Notification` lấy title/type/userId), read-only, `requireAdminSession`. Verify thật: dữ liệu log thật từ lần test push notification Phase 2 Bước 3 hiện đúng qua endpoint.
- [ ] (cân nhắc, không bắt buộc) Xem danh sách `User` + favorites của họ — hỗ trợ debug khi có báo lỗi từ người dùng thật

**Exit criteria:** sửa được tên/logo cầu thủ-đội-giải sai từ 1 form web (không cần Prisma Studio/SQL tay), bật/tắt được 1 feature flag qua UI, tra được lịch sử gửi thông báo theo user mà không cần query DB tay. → **Đạt**, verify thật 2026-08-17 (curl + browser cho toàn bộ endpoint/trang mới, `pnpm turbo run typecheck lint build test` sạch — 30/30 task).

---

## Phase 5 — AI Features (Size: L)

**Mục tiêu:** điểm khác biệt chính của app so với đối thủ.

- [x] **(2026-08-18) Quyết định: bỏ AWS Bedrock, gọi thẳng Anthropic API** — Bedrock cần mở AWS account thật + xin quyền truy cập model (approval, có thể mất thời gian) + IAM riêng, không có lợi ích thật cho quy mô app này (không cần compliance/data-residency, app chưa dùng AWS cho gì khác — auth đã là Firebase). Package mới `packages/ai-provider` (`LlmProvider` interface + `AnthropicAdapter`, mirror chính xác pattern `packages/data-provider`'s `DataProviderAdapter`) — đổi provider sau này (nếu cần) chỉ cần thêm adapter mới. Chọn qua `apps/sync-worker/src/ai-provider.ts`'s `createLlmProvider()` (env `LLM_PROVIDER`, mặc định `"anthropic"`), model mặc định `claude-haiku-4-5-20251001` (rẻ nhất, đủ cho việc tóm tắt kết quả). `ai_usage_logs` **chưa dùng** cho match summary (xem bullet dưới) — sẽ dùng thật ở Chat/player-compare (user-triggered, cần cap theo user; match summary là job hệ thống, không có user để gán quota).
- [x] **(2026-08-18) `ai_match_summary`**: tự sinh khi match chuyển sang FINISHED — trigger ở **2 nơi độc lập** (`sync-live-matches.ts` — đường nhanh khi match đang được live-poll; `sync-catalog.ts`'s `syncMatches()` — đường chắc chắn qua re-sync định kỳ, không phụ thuộc live-poll có bắt kịp hay không), gọi chung 1 hàm idempotent `generateMatchSummaryIfNeeded()` (`apps/sync-worker/src/match-summary.ts`, guard bằng `AiMatchSummary.matchId` đã `@unique`). **Không dùng Redis Pub/Sub** (khác goal-notifier Phase 2) — phát hiện lẫn xử lý đều nằm trong sync-worker, thêm channel chỉ để tự nói chuyện với mình là thừa. "Không block API" đạt bằng cách không `await` job trong vòng lặp sync chính (`void ...catch()`), không phải tách process. **Phát hiện thật quan trọng**: `Commentary`/`MatchEvent` đều rỗng hoàn toàn trong DB (không adapter provider nào từng ghi) — summary chỉ dựa trên tỉ số cuối + `Standing` (vị trí bảng xếp hạng), KHÔNG có tường thuật diễn biến theo phút (giới hạn dữ liệu thật, không phải giới hạn tính năng). Có script backfill `pnpm --filter @football-app/sync-worker backfill-match-summaries [limit]` cho match FINISHED từ trước khi tính năng này tồn tại. Hiển thị tối thiểu ở `/matches/[id]` (card "Tóm tắt trận đấu (AI)", chỉ hiện khi đã có). Verify: unit test với fake `LlmProvider` (không cần `ANTHROPIC_API_KEY` thật) — verify thật với key thật (qua backfill script) là bước cuối, làm khi gắn key.
- [ ] `ai_player_summary`, tính năng so sánh cầu thủ bằng AI (dựa trên statistics đã có ở Phase 3) — dùng lại `LlmProvider`/`AnthropicAdapter` y nguyên.
- [ ] Chat AI: `chat_history`, `prompt_templates`, embeddings + pgvector (RAG trên commentary/summary đã sinh ra) — **chỉ piece này mới cần embedding** (match summary không cần). Provider embedding: cân nhắc OpenAI (`text-embedding-3-small`) thay vì Voyage AI (Voyage đã bị MongoDB mua 2/2025, rủi ro dài hạn nếu API độc lập bị deprioritize). `AiUsageLog` dùng thật ở đây (user-triggered, cần cap theo user — khác match summary).
- [ ] Web: trang chat, trang so sánh cầu thủ có AI insight

**Exit criteria:** đọc được tóm tắt trận đấu do AI viết ✅ (verify thật cần `ANTHROPIC_API_KEY`, xem bullet `ai_match_summary`), chat hỏi được về trận/cầu thủ, so sánh 2 cầu thủ có nhận xét AI trên web — với chi phí có kiểm soát (usage cap hoạt động).

---

## Phase 6 — Hardening & Launch (Size: M)

**Mục tiêu:** sẵn sàng phát hành công khai.

- [ ] Security review: WAF, rate limiting, audit Firebase Auth config (provider settings, App Check), kiểm tra ToS API-Football về redistribute dữ liệu
- [ ] Performance: load test API tại thời điểm nhiều trận live cùng lúc (giờ vàng cuối tuần); Lighthouse/Core Web Vitals audit cho web
- [ ] Observability đầy đủ: CloudWatch dashboards, Sentry cho web, alerting chi phí (Bedrock/API-Football/Aurora)
- [ ] Deploy production: `apps/web` lên hosting thật (Vercel hoặc CloudFront+S3), domain + SSL
- [ ] `feature_flags`/`app_config` hoạt động để kill-switch tính năng lỗi mà không cần release mới

**Exit criteria:** web live trên domain thật, có dashboard theo dõi chi phí + lỗi, có cơ chế tắt tính năng khẩn cấp.

*(App Store/Play Store submission dời sang khi resume mobile — xem mục Mobile pause.)*

---

## Phase 7 — Post-launch Growth (Size: XL, mở — làm theo feedback thật)

Không chốt chi tiết trước launch vì phụ thuộc feedback người dùng thật. Các hướng dự kiến:
- **Resume `apps/mobile`** — ưu tiên cao nếu web đã có traction, vì backend/data/AI đã sẵn, chỉ cần build lại UI (Firebase Auth mobile đã xong từ trước khi pause)
- Personalization sâu hơn (feed theo hành vi xem)
- Mở rộng `apps/admin` (đã build ở Phase 4) — thêm tính năng theo nhu cầu vận hành thật sau launch, ví dụ audit log, bulk edit, dashboard chi phí AI/data provider
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
Phase 3 (Search & Stats) ──▶ Phase 5 (AI — cần statistics từ Phase 3
   │                              làm nền cho so sánh/summary)
   ▼                              │
Phase 4 (Admin Panel — độc lập,   │
   không phụ thuộc Phase 3/5,     │
   có thể làm song song)          │
   │                              │
   ▼                              ▼
Phase 6 (Hardening & Launch) ◀────┘
   │
   ▼
Phase 7 (Post-launch — bao gồm resume Mobile)
```

Phase 3 và Phase 4 có thể chạy **song song một phần** nếu team đủ người (1 track làm search/stats, 1 track làm AI infra) — chỉ cần đồng bộ ở điểm AI cần dữ liệu statistics làm input.
