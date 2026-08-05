# Roadmap — Football Mobile App

Roadmap theo phase, sắp xếp theo **thứ tự phụ thuộc** (phase sau cần phase trước xong phần lõi), không theo lịch tuần/tháng cố định — vì chưa biết quy mô team. Mỗi phase có size tương đối (S/M/L/XL) để bạn tự quy đổi theo velocity thực tế của team. Điều chỉnh lại nếu team size/deadline cụ thể khác giả định.

**Giả định:** team nhỏ (~1-3 người, có thể kiêm nhiệm mobile + backend), làm bán thời gian hoặc song song nhiều task. Nếu team lớn hơn, các track (Mobile / Backend / Infra) trong cùng phase có thể chạy song song thay vì tuần tự.

---

## Phase 0 — Foundation (Size: M)

**Mục tiêu:** có skeleton chạy được end-to-end (rỗng nhưng thông mạch), CI/CD hoạt động, không còn quyết định kiến trúc treo.

**Deliverables:**
- [ ] Monorepo setup: Turborepo config, `packages/config` (eslint/tsconfig chung)
- [ ] `packages/database`: Prisma schema baseline (toàn bộ bảng ở [PROJECT_PLAN.md § 4](./PROJECT_PLAN.md#4-database-design-theo-module-đã-cập-nhật)), migration đầu tiên
- [ ] `apps/api`: Hono skeleton, health-check endpoint, Cognito JWT middleware
- [ ] `apps/mobile`: Flutter skeleton, GoRouter setup, Riverpod providers rỗng, kết nối Dio tới `apps/api`
- [ ] AWS Cognito: user pool + app client, test được register/login từ mobile
- [ ] `infrastructure/terraform`: baseline (VPC, Aurora instance nhỏ, S3 bucket, API Gateway REST) — chưa cần Redis/OpenSearch/Bedrock
- [ ] CI: lint + test + build chạy trên PR (`github-actions`)
- [ ] Xác nhận giá/rate-limit thực tế của API-Football, tạo account + API key test

**Exit criteria:** đăng ký/login từ app thật, gọi được 1 API rỗng, deploy tự động qua CI.

---

## Phase 1 — MVP Core: Data & Browse (Size: L)

**Mục tiêu:** người dùng browse được dữ liệu bóng đá thật (không real-time, không AI) — thay thế phần "xem thông tin" cơ bản của Sofascore/FotMob.

**Backend/Data:**
- [ ] `packages/data-provider`: canonical model + adapter API-Football
- [ ] `apps/sync-worker`: job định kỳ (cron đơn giản, CHƯA cần Step Functions) đồng bộ competitions/teams/players/matches/standings vào Aurora
- [ ] API: `/competitions`, `/teams`, `/players`, `/matches` (list/detail), `/standings`, `/statistics` cơ bản
- [ ] Admin tool tối giản (script hoặc trang đơn giản) để sửa tay dữ liệu sai từ provider

**Mobile:**
- [ ] Màn hình: danh sách giải đấu, bảng xếp hạng, chi tiết trận đấu (đã kết thúc/sắp diễn ra), chi tiết team/player
- [ ] `favorite_teams`/`favorite_players`: wire UI + API `/favorites`
- [ ] Hive cho cache local (offline browse cơ bản)

**Exit criteria:** xem được lịch thi đấu, kết quả, bảng xếp hạng, follow được team/player yêu thích — hoàn toàn bằng dữ liệu thật.

---

## Phase 2 — Real-time & Notifications (Size: L)

**Mục tiêu:** trải nghiệm "theo dõi thời gian thực" — điểm khác biệt cốt lõi so với việc chỉ xem kết quả tĩnh.

**Bước 1 (REST polling trước — ra sản phẩm sớm):**
- [ ] `live_match_state` table + Redis cache
- [ ] `GET /matches/live`, `GET /matches/{id}/live`, `GET /matches/{id}/events?since_seq`
- [ ] Mobile: polling ngắn (2-3s) khi vào màn hình live match — đủ để demo/dùng thật

**Bước 2 (nâng cấp lên WebSocket thật):**
- [ ] API Gateway WebSocket + Lambda handlers (`$connect`/`$disconnect`/subscribe)
- [ ] `ws_connections` (DynamoDB)
- [ ] Mobile: chuyển từ polling sang `web_socket_channel`, giữ REST làm fallback/catch-up khi reconnect

**Bước 3 (thông báo khi không mở app):**
- [ ] SNS fan-out "match-updates" → Lambda fcm-push, nối với `notification_settings`
- [ ] `notifications`/`notification_logs` wiring

**Bước 4 (tối ưu chi phí ingestion — có thể làm sau, không chặn release):**
- [ ] EventBridge Scheduler + Step Functions thay cron cố định cho sync-worker (adaptive polling theo trận live)

**Exit criteria:** mở app đúng lúc trận đang diễn ra, thấy tỉ số/event cập nhật không cần refresh tay; nhận được push khi team yêu thích ghi bàn.

---

## Phase 3 — Search & Deeper Stats (Size: M)

**Mục tiêu:** tính năng tìm kiếm và thống kê chuyên sâu — cạnh tranh trực tiếp với Sofascore ở phần "chuyên sâu".

- [ ] `/search` dùng Postgres full-text search (chưa cần OpenSearch — xem [PROJECT_PLAN.md § 7.1](./PROJECT_PLAN.md#71-chiến-lược-costcomplexity-theo-phase-nguyên-tắc-chung))
- [ ] `search_history`
- [ ] `top_scorers`, `top_assists`, `clean_sheets` — tính toán từ dữ liệu match đã có (job tổng hợp định kỳ)
- [ ] Player/team statistics chi tiết hơn (so sánh cơ bản giữa 2 cầu thủ — nền cho tính năng AI compare ở Phase 4)
- [ ] `match_lineups`, `formations`, `player_ratings`, `team_ratings`, `commentaries` — hoàn thiện màn hình chi tiết trận

**Exit criteria:** tìm được team/player nhanh, xem được top scorer/assist theo giải, chi tiết trận đầy đủ (lineup, formation, rating).

---

## Phase 4 — AI Features (Size: L)

**Mục tiêu:** điểm khác biệt chính của app so với đối thủ.

- [ ] Bedrock setup + `ai_usage_logs` (cap usage/user NGAY từ đầu, tránh chi phí vượt kiểm soát)
- [ ] `ai_match_summary`: tự sinh tóm tắt sau khi trận kết thúc (trigger async từ SNS fan-out có sẵn ở Phase 2, không block API)
- [ ] `ai_player_summary`, tính năng so sánh cầu thủ bằng AI (dựa trên statistics đã có ở Phase 3)
- [ ] Chat AI: `chat_history`, `prompt_templates`, embeddings qua Titan + pgvector (RAG trên commentary/summary đã sinh ra)
- [ ] Mobile: màn hình chat, màn hình so sánh cầu thủ có AI insight

**Exit criteria:** đọc được tóm tắt trận đấu do AI viết, chat hỏi được về trận/cầu thủ, so sánh 2 cầu thủ có nhận xét AI — với chi phí có kiểm soát (usage cap hoạt động).

---

## Phase 5 — Hardening & Launch (Size: M)

**Mục tiêu:** sẵn sàng phát hành công khai.

- [ ] Security review: WAF, rate limiting, audit Cognito config, kiểm tra ToS API-Football về redistribute dữ liệu
- [ ] Performance: load test API tại thời điểm nhiều trận live cùng lúc (giờ vàng cuối tuần)
- [ ] Observability đầy đủ: CloudWatch dashboards, alerting chi phí (Bedrock/API-Football/Aurora)
- [ ] Crashlytics review, fix crash-free rate trước submit
- [ ] App Store + Play Store submission (metadata, privacy policy, screenshots)
- [ ] `feature_flags`/`app_config` hoạt động để kill-switch tính năng lỗi mà không cần release mới

**Exit criteria:** app live trên 2 store, có dashboard theo dõi chi phí + lỗi, có cơ chế tắt tính năng khẩn cấp.

---

## Phase 6 — Post-launch Growth (Size: XL, mở — làm theo feedback thật)

Không chốt chi tiết trước launch vì phụ thuộc feedback người dùng thật. Các hướng dự kiến:
- Personalization sâu hơn (feed theo hành vi xem)
- `apps/admin` đầy đủ (nếu tool tối giản ở Phase 1 không còn đủ)
- Mở rộng coverage giải đấu / nâng cấp data provider (Sportradar/Opta) nếu doanh thu cho phép
- Monetization: ads, subscription cho tính năng AI nâng cao
- Đa ngôn ngữ ngoài Việt/English nếu có nhu cầu thị trường

---

## Tổng quan phụ thuộc giữa các phase

```
Phase 0 (Foundation)
   │
   ▼
Phase 1 (Data & Browse) ──────────┐
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
Phase 6 (Post-launch)
```

Phase 3 và Phase 4 có thể chạy **song song một phần** nếu team đủ người (1 track làm search/stats, 1 track làm AI infra) — chỉ cần đồng bộ ở điểm AI cần dữ liệu statistics làm input.
