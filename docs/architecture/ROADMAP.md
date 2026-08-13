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
- [ ] Xác nhận giá/rate-limit thực tế của API-Football, tạo account + API key test
- [ ] **(mới)** `apps/web`: scaffold Next.js — chưa làm, xem Phase 1

**Exit criteria:** đăng ký/login từ app thật, gọi được 1 API rỗng, deploy tự động qua CI. → **Chưa đạt đầy đủ cho Web** (login/API đã verify được cho mobile trước khi pause; cần lặp lại phần Web app registration + đăng nhập thật trên web ở Phase 1). CI mới validate, chưa có bước deploy.

---

## Phase 1 — MVP Core: Data & Browse (Size: L)

**Mục tiêu:** người dùng browse được dữ liệu bóng đá thật (không real-time, không AI) — thay thế phần "xem thông tin" cơ bản của Sofascore/FotMob.

**Backend/Data:**
- [x] `packages/data-provider`: canonical model + adapter API-Football — đã thêm `fetchCompetitions`/`fetchSeasons`/`fetchTeams`/`fetchPlayers`/`fetchMatches` (mapping field theo docs API-Football, **chưa verify với response thật** — chưa có API key, xem mục dưới)
- [x] `apps/sync-worker`: `sync-catalog.ts` (syncCompetitions → syncSeasons → syncTeams → syncPlayers → syncStandings/syncMatches, đúng thứ tự phụ thuộc) + `sync-all.ts` orchestrator (cron đơn giản, đọc `SYNC_COMPETITION_IDS`/`SYNC_SEASON_YEAR` từ env) — verify thật bằng mock adapter + Postgres Docker (5 test pass: upsert idempotent, FK resolve, throw đúng khi thiếu dependency, skip team lạ)
- [x] API: `/competitions`, `/teams` (+ `/teams/:id/players`), `/players`, `/matches` (list có filter `competitionId`/`status`, detail), `/standings?seasonId=`, `/statistics/teams|players/:id?seasonId=` — verify thật qua curl với data seed (không phải chỉ build pass)
- [ ] Admin tool tối giản (script hoặc trang đơn giản) để sửa tay dữ liệu sai từ provider — chưa làm
- [ ] **Còn blocked**: chưa có API-Football key thật → adapter mapping (field name JSON thật) chưa verify được, `sync-all.ts` chưa chạy thử với data thật

**Web (client chính — đổi từ Mobile theo pivot):**
- [ ] Scaffold `apps/web` (Next.js) + `packages/ui` baseline
- [ ] Đăng ký Web app trong Firebase project, wire Firebase Auth (Google/Phone) cho web
- [ ] Trang: danh sách giải đấu, bảng xếp hạng, chi tiết trận đấu (đã kết thúc/sắp diễn ra), chi tiết team/player
- [ ] `favorite_teams`/`favorite_players`: wire UI + API `/favorites`
- [ ] Caching: dùng SSR/ISR của Next.js cho trang public + client cache (React Query hoặc tương đương) — không cần offline cache kiểu Hive như mobile

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
