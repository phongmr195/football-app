# Football Mobile App — Master Plan (Tổng thể)

Bản tổng hợp toàn bộ quyết định kiến trúc, gộp plan gốc + các sửa đổi đã thống nhất (data provider, real-time). Đây là tài liệu tham chiếu chính; chi tiết real-time xem thêm [data-provider-and-realtime-plan.md](./data-provider-and-realtime-plan.md).

---

## 1. Vision & Scope

**Sản phẩm:** App mobile theo dõi bóng đá thời gian thực, thống kê chuyên sâu, có AI hỗ trợ phân tích — định vị giữa Sofascore/FotMob/OneFootball, khác biệt bằng AI.

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

### Mobile
| Component | Technology |
|---|---|
| Framework | Flutter |
| State Management | Riverpod |
| Routing | GoRouter |
| Local Database | Hive |
| Networking | Dio |
| Real-time | `web_socket_channel` (kết nối WebSocket API Gateway) |
| Authentication | AWS Cognito |
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
| Authentication | Cognito JWT (verify trực tiếp, không thêm lớp JWT riêng trừ khi có nhu cầu cụ thể cho guest/anonymous access) |
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

Chi tiết lý do & thiết kế: [data-provider-and-realtime-plan.md § 1](./data-provider-and-realtime-plan.md#1-data-provider--quyết-định)

---

## 3. System Architecture (tổng hợp)

```
                        Flutter App
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

Chi tiết protocol: [data-provider-and-realtime-plan.md § 4](./data-provider-and-realtime-plan.md#4-thay-đổi-api)

---

## 6. Monorepo Structure (đã cập nhật)

```
football-app/
│
├── apps/
│   ├── mobile/          # Flutter (quản lý bằng Melos nếu tách nhiều package sau)
│   ├── api/              # Hono API
│   ├── admin/            # Web quản trị — xem mục 8, đẩy sớm hơn dự kiến ban đầu
│   └── sync-worker/      # Ingestion: data-provider adapter + Step Functions handlers
│
├── packages/
│   ├── database/         # Prisma schema + migrations
│   ├── shared/            # Types/constants dùng chung TS
│   ├── sdk/                # Client SDK gọi API (dùng bởi admin/mobile-codegen nếu cần)
│   ├── ui/                 # Design system components (nếu admin dùng React)
│   ├── data-provider/    # (mới) Adapter pattern — canonical model + adapter API-Football
│   └── config/             # (mới) eslint/tsconfig/prettier chung cho toàn bộ TS packages
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
- **Turborepo** cho `apps/api`, `apps/admin`, `apps/sync-worker`, `packages/*` (TS ecosystem)
- **Melos** riêng cho Flutter nếu `apps/mobile` tách thành nhiều package (không bắt buộc ở MVP, 1 package Flutter là đủ)

---

## 7. Non-functional Requirements

### 7.1. Chiến lược cost/complexity theo phase (nguyên tắc chung)

Không dựng toàn bộ Aurora + Redis + OpenSearch + Bedrock cùng lúc từ đầu. Nguyên tắc: **chỉ thêm 1 thành phần hạ tầng khi có nhu cầu thật đo được** (không phải khi "nghĩ là sẽ cần").
- OpenSearch: hoãn tới khi Postgres FTS không đủ nhanh/đủ tính năng cho search
- OpenSearch Vector: hoãn tới khi pgvector không đủ scale cho AI retrieval
- ElastiCache Redis cluster lớn: bắt đầu bằng 1 node nhỏ, scale khi cần

### 7.2. Observability
- CloudWatch Logs/Metrics cho toàn bộ Lambda + API
- Sentry (hoặc CloudWatch + X-Ray) cho error tracking backend
- Firebase Crashlytics cho mobile (đã có trong stack gốc)
- Dashboard riêng cho chi phí Bedrock/API-Football theo ngày (tránh bị "đốt tiền" âm thầm)

### 7.3. Security
- WAF trên API Gateway (rate limiting theo IP, chống scrape ngược)
- Cognito cho auth, không tự chế session token trừ khi có ca cụ thể
- Secrets qua AWS Secrets Manager, không hardcode API key provider

### 7.4. Testing
- Backend: unit test cho business logic (Vitest/Jest), integration test cho API routes (test DB riêng)
- Mobile: `integration_test` package cho golden path (xem live match, favorite team, chat AI)
- CI chạy test + lint trên mọi PR (`infrastructure/github-actions`)

### 7.5. i18n
- MVP: tiếng Việt + English, dùng key-based translation (Flutter: `easy_localization` hoặc tương đương)
- Chưa cần bảng `translations` trong DB ở MVP — dùng file JSON tĩnh; chỉ đưa vào DB nếu cần quản trị nội dung động sau này

---

## 8. Ghi chú về `apps/admin`

Plan gốc để admin là "tùy chọn". Thực tế nên có **admin tool tối giản từ Phase 1** (không cần là app đầy đủ) vì:
- Dữ liệu từ API-Football có thể sai/thiếu (tên cầu thủ, logo...) — cần cách sửa tay nhanh, không phải sửa trực tiếp DB
- Cần nơi quản lý `feature_flags`/`app_config` mà không phải chạy SQL tay

Có thể bắt đầu bằng 1 CLI script hoặc trang admin cực đơn giản (list + edit form), nâng cấp thành app đầy đủ ở phase sau nếu cần.

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
