# Football App — Master Plan (Tổng thể)

Bản tổng hợp toàn bộ quyết định kiến trúc, gộp plan gốc + các sửa đổi đã thống nhất (data provider, real-time, pivot Web). Đây là tài liệu tham chiếu chính.

---

## 1. Vision & Scope

**Sản phẩm:** App theo dõi bóng đá thời gian thực, thống kê chuyên sâu, có AI hỗ trợ phân tích — định vị giữa Sofascore/FotMob/OneFootball, khác biệt bằng AI.

### Pivot: Web trước, Mobile tạm pause (2026-08-07)

**Chốt:** chuyển client chính sang **Web (Next.js)**, tạm pause phát triển `apps/mobile` (Flutter). Backend/data/AI không đổi — mọi client (web, mobile sau này) dùng chung 1 API.

- `apps/mobile` đã hoàn thành xong phần lớn Phase 0 (Flutter skeleton, Riverpod, GoRouter, Dio, Firebase Auth với Google + Phone provider đã enable và verify chạy được trên iOS Simulator) — **giữ nguyên code, không xoá**, resume sau khi web ổn định. Xem trạng thái chi tiết ở [ROADMAP.md § Mobile — tạm pause](./ROADMAP.md#mobile--tạm-pause-trạng-thái-t%E1%BA%A1i-th%E1%BB%9Di-%C4%91i%E1%BB%83m-pause).
- Từ Phase 1 trở đi, phần UI trong roadmap ghi **Web** thay vì **Mobile** — đây là track chủ lực hiện tại.
- `packages/ui` (design system) chuyển từ "dùng nếu admin cần" (plan gốc) sang **dùng thật ngay từ đầu** cho `apps/web`.

**Phạm vi MVP (giới hạn để kiểm soát chi phí data provider):**
- Chỉ cover **top ~10-15 giải đấu** phổ biến (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League, V-League, World Cup/Euro khi diễn ra...) — KHÔNG cố cover toàn bộ giải như Sofascore ngay từ đầu
- Mở rộng coverage dần theo giai đoạn, dựa trên rate-limit/tier của data provider

**Không làm ở MVP** (để tránh scope creep):
- Betting/odds tích hợp sâu
- Video highlights/streaming
- Fantasy football
- Đa ngôn ngữ (chỉ tiếng Việt + English ở MVP)

---

## 2. Tech Stack (final)

### Web (client chính hiện tại)
| Component | Technology |
|---|---|
| Framework | Next.js (React) |
| Rendering | SSR/ISR cho trang public (SEO — điểm khác biệt so với Flutter Web) |
| Styling | Tailwind (hoặc tương đương — chốt khi scaffold) |
| Networking | `fetch`/API client gọi trực tiếp `apps/api` (Hono) |
| Real-time | WebSocket API của browser (kết nối API Gateway WebSocket) |
| Authentication | **Firebase Authentication** (Google, Facebook, Phone number) — dùng Firebase JS SDK |
| Design system | `packages/ui` (dùng chung với `apps/admin` sau này nếu có) |

### Mobile — tạm pause (2026-08-07, xem § 1 Pivot)
| Component | Technology |
|---|---|
| Framework | Flutter |
| State Management | Riverpod |
| Routing | GoRouter |
| Local Database | Hive |
| Networking | Dio |
| Real-time | `web_socket_channel` (kết nối WebSocket API Gateway) |
| Authentication | **Firebase Authentication** (Google, Facebook, Phone number) — đã setup + verify xong trước khi pause |
| Push Notification | Firebase Cloud Messaging |
| Crash Analytics | Firebase Crashlytics |

### Backend
| Component | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Hono |
| Language | TypeScript |
| Validation | Zod |
| ORM | Prisma |
| Authentication | **Firebase Admin SDK** (`verifyIdToken`), verify trực tiếp token từ Firebase Auth — không thêm lớp JWT riêng trừ khi có nhu cầu cụ thể cho guest/anonymous access |
| Scheduler (định kỳ, không real-time) | EventBridge + Lambda |
| Scheduler (real-time, adaptive) | EventBridge Scheduler (one-off) + Step Functions |
| API | REST (WebSocket riêng cho live; GraphQL không đưa vào roadmap gần) |

### Database
| Component | Technology | Ghi chú |
|---|---|---|
| Main Database | Amazon Aurora PostgreSQL | |
| Cache | ElastiCache Redis | live state, session, rate-limit counters |
| Search | **Postgres full-text search (MVP)** → OpenSearch (khi cần) | Xem mục 7.1 — hoãn OpenSearch để giảm cost/complexity giai đoạn đầu |
| Vector Search (AI) | **pgvector extension trên Aurora (MVP)** → OpenSearch Vector (khi scale) | Cùng lý do trên |
| Connection registry (WS) | DynamoDB | ephemeral state, không phù hợp Aurora |
| Storage | Amazon S3 | |

### AI
| Component | Technology |
|---|---|
| LLM | Amazon Bedrock |
| Embedding | Amazon Titan |
| Chat | Claude (qua Bedrock) |
| Vector Search | pgvector (MVP) → OpenSearch Vector (scale) |

### Data Provider
| Component | Decision |
|---|---|
| Primary provider (MVP) | **API-Football (RapidAPI)** |
| Isolation | Adapter pattern — `packages/data-provider` với canonical model nội bộ |
| Upgrade path | Sportradar / StatsPerform (Opta) khi có doanh thu, không đổi schema/API |

### Authentication — quyết định đổi từ Cognito sang Firebase Auth (2026-08-06)

**Chốt: Firebase Authentication**, thay AWS Cognito như plan gốc. Lý do:
- Scope auth thực tế chỉ cần **Google / Facebook / Phone number** — Firebase Auth hỗ trợ cả 3 built-in, không cần cấu hình federated identity provider phức tạp như Cognito.
- Dự án đang **chỉ dev/test local, chưa deploy AWS** — Cognito không có emulator local đáng tin cậy, phải có AWS thật mới test được. Firebase có **Auth Emulator** (`firebase emulators:start`) test được đăng nhập hoàn toàn ở local, không cần project thật lúc đầu.
- Firebase đã có trong stack sẵn cho FCM (push) và Crashlytics — dùng luôn Firebase Auth không phát sinh thêm vendor mới.
- Đánh đổi: mất khả năng dùng chung 1 hệ IAM với các AWS service khác (Aurora, S3...) qua Cognito — nhưng ở scope hiện tại (chỉ cần login), điều này không quan trọng.

**Đã xong** (project `jankara-e2e-test`, dùng chung với vài project khác của chủ repo — không phải project riêng cho football-app):
1. Tạo/chọn Firebase project qua `firebase login` + `firebase projects:list`
2. Bật Google + Phone provider trong Firebase Console → Authentication → Sign-in method
3. `flutterfire configure` trong `apps/mobile` → sinh `firebase_options.dart` + `google-services.json`/`GoogleService-Info.plist` + thêm `GIDClientID`/URL scheme vào `Info.plist` (bước riêng, `flutterfire configure` không tự làm)
4. Verify: đăng nhập Google chạy thật trên iOS Simulator

**Còn cần làm cho Web** (client chính hiện tại):
1. Đăng ký Web app trong Firebase Console (project `jankara-e2e-test`) → lấy Firebase JS SDK config
2. Thêm Firebase JS SDK vào `apps/web`, khởi tạo tương tự `Firebase.initializeApp()` bên mobile
3. Backend không đổi gì thêm: `apps/api` verify token qua `firebase-admin` — dùng chung cho cả web và mobile, không phân biệt client
4. Facebook provider: chưa bật (cần thêm App ID/Secret từ [developers.facebook.com](https://developers.facebook.com)) — thêm khi có nhu cầu thật

---

## 3. System Architecture (tổng hợp)

```
                    Web App (Next.js) — client chính
                     │              │
                (REST)              (WebSocket)
                     ▼              ▼
              CloudFront ──▶ API Gateway (REST + WS)
                     │              │
                     ▼              ▼
                 Hono API      Lambda (WS handlers)
                     │              │
        ┌────────────┼──────────┐   ▼
        ▼            ▼          ▼  DynamoDB (ws_connections)
     Aurora       Redis    pgvector/OpenSearch*
        │                        │
        ▼                        ▼
   Bedrock (AI, async)    S3 (assets: logo, ảnh)

   ── Ingestion pipeline (tách riêng khỏi luồng serving) ──
   EventBridge Scheduler ──▶ Step Functions ──▶ Lambda (sync-worker)
                                                    │
                                          packages/data-provider (adapter)
                                                    │
                                            API-Football (external)
                                                    │
                                     ghi Aurora + fan-out SNS "match-updates"
                                          ├──▶ Lambda ws-push  → API GW WS
                                          └──▶ Lambda fcm-push → FCM
```
*OpenSearch chỉ bật khi vượt ngưỡng mà Postgres FTS/pgvector không đáp ứng (xem mục 7.1).

---

## 4. Database Design (theo module, đã cập nhật)

Giữ nguyên cấu trúc module gốc, đánh dấu **(mới)**/**(sửa)** cho phần bổ sung.

### User Module
`users`, `user_profiles`, `favorite_teams`, `favorite_players`, `notification_settings`, `devices`

### Competition Module
`competitions`, `seasons`, `rounds`, `stages`
- **(mới)** `external_ref JSONB` trên `competitions` — map ID provider

### Team Module
`teams`, `team_statistics`, `team_rankings`, `team_logos`, `stadiums`, `coaches`
- **(mới)** `external_ref JSONB` trên `teams`
- **(mới)** `referees` — thiếu ở plan gốc, cần cho match detail

### Player Module
`players`, `player_statistics`, `player_awards`, `player_transfers`, `player_careers`, `player_injuries`, `player_contracts`
- **(mới)** `external_ref JSONB` trên `players`

### Match Module
`matches`, `match_statistics`, `match_events`, `match_lineups`, `formations`, `player_ratings`, `team_ratings`, `commentaries`
- **(mới)** `external_ref JSONB` trên `matches`
- **(sửa)** `match_events.seq` — sequence number tăng dần theo match, dùng cho dedup & catch-up khi client reconnect WS
- **(mới)** `live_match_state` — bảng denormalized riêng cho trạng thái live (status, minute, score, last_event_seq), nguồn cho cache Redis và REST snapshot endpoint

### Standing Module
`standings`, `top_scorers`, `top_assists`, `clean_sheets`

### AI Module
`ai_match_summary`, `ai_player_summary`, `chat_history`, `prompt_templates`, `embeddings`
- **(mới)** `ai_usage_logs` — track token/cost usage theo user + feature, cần để kiểm soát chi phí Bedrock

### Notification Module
`notifications`, `notification_logs`, `subscriptions`

### Search
`search_history`

### Platform/Ops Module **(mới — thiếu ở plan gốc)**
- `app_config` / `feature_flags` — remote control tính năng không cần chờ App Store/Play review
- (Ngoài Aurora) `ws_connections` — DynamoDB, connection registry cho WebSocket

---

## 5. API Modules (đã cập nhật)

Giữ nguyên các module gốc: `/auth`, `/users`, `/teams`, `/players`, `/matches`, `/competitions`, `/standings`, `/search`, `/favorites`, `/notifications`, `/ai`, `/statistics`

**Bổ sung:**
- `GET /matches/live` — danh sách trận đang live (cache Redis TTL ~5s)
- `GET /matches/{id}/live` — snapshot trạng thái live hiện tại
- `GET /matches/{id}/events?since_seq=N` — catch-up events
- `WS wss://api.<domain>/live` — subscribe/unsubscribe theo matchId, nhận push `match.snapshot` / `match.event` / `match.status_change`

---

## 6. Monorepo Structure (đã cập nhật)

```
football-app/
│
├── apps/
│   ├── web/              # (mới) Next.js — client chính, xem § 1 Pivot
│   ├── mobile/          # Flutter — TẠM PAUSE (2026-08-07), giữ code, resume sau
│   ├── api/              # Hono API
│   ├── admin/            # Web quản trị — xem mục 8, đẩy sớm hơn dự kiến ban đầu
│   └── sync-worker/      # Ingestion: data-provider adapter + Step Functions handlers
│
├── packages/
│   ├── database/         # Prisma schema + migrations
│   ├── shared/            # Types/constants dùng chung TS
│   ├── sdk/                # Client SDK gọi API (dùng bởi web/admin nếu cần)
│   ├── ui/                 # Design system components — dùng thật cho apps/web từ đầu
│   ├── data-provider/    # Adapter pattern — canonical model + adapter API-Football
│   └── config/             # eslint/tsconfig/prettier chung cho toàn bộ TS packages
│
├── infrastructure/
│   ├── terraform/
│   ├── docker/
│   └── github-actions/
│
└── docs/
    └── architecture/
```

**Tooling điều phối build:**
- **Turborepo** cho `apps/web`, `apps/api`, `apps/admin`, `apps/sync-worker`, `packages/*` (TS ecosystem)
- **Melos** riêng cho Flutter nếu `apps/mobile` tách thành nhiều package — không ưu tiên trong lúc pause

---

## 7. Non-functional Requirements

### 7.1. Chiến lược cost/complexity theo phase (nguyên tắc chung)

Không dựng toàn bộ Aurora + Redis + OpenSearch + Bedrock cùng lúc từ đầu. Nguyên tắc: **chỉ thêm 1 thành phần hạ tầng khi có nhu cầu thật đo được** (không phải khi "nghĩ là sẽ cần").
- OpenSearch: hoãn tới khi Postgres FTS không đủ nhanh/đủ tính năng cho search
- OpenSearch Vector: hoãn tới khi pgvector không đủ scale cho AI retrieval
- ElastiCache Redis cluster lớn: bắt đầu bằng 1 node nhỏ, scale khi cần

### 7.2. Observability
- CloudWatch Logs/Metrics cho toàn bộ Lambda + API
- Sentry (hoặc CloudWatch + X-Ray) cho error tracking backend + web
- Firebase Crashlytics cho mobile — giữ khi resume, không cần cho web (Sentry đủ)
- Dashboard riêng cho chi phí Bedrock/API-Football theo ngày (tránh bị "đốt tiền" âm thầm)

### 7.3. Security
- WAF trên API Gateway (rate limiting theo IP, chống scrape ngược)
- Firebase Auth cho auth (Google/Facebook/Phone), không tự chế session token trừ khi có ca cụ thể
- Secrets qua AWS Secrets Manager, không hardcode API key provider

### 7.4. Testing
- Backend: unit test cho business logic (Vitest/Jest), integration test cho API routes (test DB riêng)
- Web: Vitest/React Testing Library cho component, Playwright cho golden path E2E (xem live match, favorite team, chat AI)
- Mobile (khi resume): `integration_test` package cho golden path tương tự
- CI chạy test + lint trên mọi PR (`infrastructure/github-actions`)

### 7.5. i18n
- MVP: tiếng Việt + English, dùng key-based translation (Next.js: `next-intl` hoặc tương đương; Flutter khi resume: `easy_localization`)
- Chưa cần bảng `translations` trong DB ở MVP — dùng file JSON tĩnh; chỉ đưa vào DB nếu cần quản trị nội dung động sau này

---

## 8. Ghi chú về `apps/admin`

Plan gốc để admin là "tùy chọn". Thực tế nên có **admin tool tối giản từ Phase 1** (không cần là app đầy đủ) vì:
- Dữ liệu từ API-Football có thể sai/thiếu (tên cầu thủ, logo...) — cần cách sửa tay nhanh, không phải sửa trực tiếp DB
- Cần nơi quản lý `feature_flags`/`app_config` mà không phải chạy SQL tay

Có thể bắt đầu bằng 1 CLI script hoặc trang admin cực đơn giản (list + edit form), nâng cấp thành app đầy đủ ở phase sau nếu cần. Từ khi có `apps/web`, `apps/admin` có thể dùng chung `packages/ui` để đỡ công design system riêng.

---

## 9. Rủi ro & quyết định còn mở

| Rủi ro/Quyết định | Trạng thái |
|---|---|
| Giá & rate-limit thực tế của API-Football | Cần verify trên RapidAPI trước khi cam kết budget |
| Điều khoản sử dụng lại dữ liệu (hiển thị trong app công khai) | Cần đọc kỹ ToS của API-Football về việc redistribute dữ liệu trong app thương mại |
| Chi phí Bedrock ở scale | Cần cap usage/user (free tier giới hạn số lần chat AI/ngày) — nối với `ai_usage_logs` |
| Ngưỡng chuyển OpenSearch | Chưa xác định cụ thể — đặt lại khi có traffic thật để đo |

---

Xem roadmap thực thi theo phase tại [ROADMAP.md](./ROADMAP.md).
