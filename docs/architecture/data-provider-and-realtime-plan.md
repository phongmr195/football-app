# Data Provider & Real-time Architecture — Plan chi tiết

Bổ sung/sửa đổi cho plan tổng ở mức kiến trúc, tập trung vào 2 quyết định nền tảng: **nguồn dữ liệu bóng đá** và **cơ chế real-time**. Mọi phần khác (schema, API modules, monorepo...) giữ nguyên theo plan gốc trừ khi ghi rõ thay đổi.

---

## 1. Data Provider — Quyết định

### Chốt cho MVP: **API-Football (qua RapidAPI)**

**Vì sao chọn:**
- Không cần ký hợp đồng dài hạn, trả theo tháng, dễ bắt đầu và dễ dừng nếu pivot
- Coverage đủ rộng (hàng trăm giải, live score, lineups, stats, odds cơ bản) — đủ cho MVP tới giai đoạn có traffic thật
- Có sẵn live-update endpoint (polling-based) và webhook cho một số gói — khớp với nhu cầu real-time
- Chi phí thấp hơn nhiều bậc so với Opta/Sportradar/StatsPerform, phù hợp giai đoạn chưa có doanh thu

**Hạn chế cần biết trước:**
- Độ sâu dữ liệu (heatmap, xG chi tiết, tracking data) không bằng Opta — nếu sau này cần tính năng phân tích sâu như Sofascore thì sẽ cần nâng cấp provider
- Rate limit theo gói — cần thiết kế cache/Redis chặt để không gọi provider dư thừa
- **Cần tự verify giá & rate limit hiện tại trên RapidAPI trước khi cam kết budget** — giá có thể đã thay đổi so với thời điểm plan này viết

**Lộ trình nâng cấp (Phase 2+):** khi có doanh thu/traffic đủ lớn, chuyển sang Sportradar hoặc StatsPerform (Opta) để có độ chi tiết ngang Sofascore/FotMob thật. Việc chuyển đổi được thiết kế để **không đụng vào schema hay API layer** nhờ adapter pattern ở mục 1.1.

### 1.1. Adapter Pattern — cách ly vendor lock-in

Thêm package mới: `packages/data-provider/`

```
packages/data-provider/
├── src/
│   ├── types.ts              # Canonical model — hình dạng dữ liệu nội bộ của app
│   ├── adapters/
│   │   ├── api-football.adapter.ts
│   │   └── (future) sportradar.adapter.ts
│   └── provider.interface.ts # Interface chung mọi adapter phải implement
```

- **Canonical model**: định nghĩa `CanonicalMatch`, `CanonicalTeam`, `CanonicalPlayer`, `CanonicalEvent`... theo hình dạng app mình cần — KHÔNG theo hình dạng JSON của API-Football.
- Mỗi adapter chỉ có 1 việc: map JSON thô của provider → canonical model.
- `sync-worker` chỉ làm việc với canonical model, không biết provider là gì.
- Khi đổi provider: viết adapter mới, giữ nguyên toàn bộ downstream (DB schema, API, mobile app).

### 1.2. Mapping ID giữa hệ thống mình và provider

Thêm cột vào các bảng lõi (đổi so với plan gốc):

```
matches.external_ref       JSONB   -- { "provider": "api-football", "id": "12345" }
teams.external_ref         JSONB
players.external_ref       JSONB
competitions.external_ref  JSONB
```

Dùng JSONB thay vì cột `provider_id` cứng để dễ mở rộng khi có nhiều provider (merge dữ liệu) sau này mà không cần migration lớn.

---

## 2. Real-time Architecture

### 2.1. Vấn đề với thiết kế cũ

EventBridge cron cố định (ví dụ mỗi 1 phút) không hợp lý vì:
- Trận **chưa đá**: không cần poll → tốn tiền vô ích
- Trận **đang live**: cần poll mỗi 10-15s để cảm giác "real-time" thật
- Trận **đã kết thúc**: cần dừng poll ngay, không để chạy dư

→ Cần polling **thích ứng theo trạng thái trận**, không dùng cron cố định.

### 2.2. Kiến trúc đề xuất (end-to-end)

```
                    ┌─────────────────────────┐
                    │  EventBridge Scheduler   │
                    │  (one-off, tạo lúc có    │
                    │   trận sắp kickoff -5p)  │
                    └────────────┬─────────────┘
                                 │ trigger
                                 ▼
                    ┌─────────────────────────┐
                    │   Step Functions          │
                    │   (Express Workflow)      │
                    │   loop: poll → wait 15s   │
                    │   → exit khi status=FT    │
                    └────────────┬─────────────┘
                                 │ mỗi vòng lặp
                                 ▼
                    ┌─────────────────────────┐
                    │  Lambda: fetch-live-data  │
                    │  (gọi API-Football qua    │
                    │   adapter, so sánh diff)  │
                    └────────────┬─────────────┘
                     ghi mới nếu có thay đổi
                                 ▼
              ┌──────────────────┴───────────────────┐
              ▼                                       ▼
     ┌─────────────────┐                    ┌──────────────────┐
     │  Aurora Postgres  │                    │   SNS Topic        │
     │  (durable write:   │                    │  "match-updates"   │
     │   match_events,    │                    └─────────┬─────────┘
     │   live_match_state)│                              │
     └─────────────────┘                    ┌─────────────┴─────────────┐
                                             ▼                           ▼
                                   ┌──────────────────┐      ┌──────────────────┐
                                   │ Lambda: ws-push    │      │ Lambda: fcm-push   │
                                   │ (đọc ws_connections│      │ (check favorite_   │
                                   │  trong DynamoDB,   │      │  teams, gửi FCM     │
                                   │  push qua API GW   │      │  nếu goal/kết quả)  │
                                   │  Management API)   │      └──────────────────┘
                                   └────────┬───────────┘
                                            │
                                            ▼
                                 ┌─────────────────────┐
                                 │ API Gateway WebSocket │
                                 │  → Flutter client     │
                                 └─────────────────────┘
```

**Điểm mấu chốt:**
- Polling chỉ chạy trong khoảng thời gian trận đấu thực sự diễn ra → tối ưu chi phí
- 1 message SNS fan-out ra 2 nhánh độc lập: push real-time cho user đang xem (WebSocket) và push notification cho user quan tâm nhưng không mở app (FCM) — tận dụng đúng bảng `favorite_teams`/`notification_settings` đã có trong schema
- Aurora vẫn là nguồn sự thật (durable), WebSocket/FCM chỉ là lớp thông báo tức thời

### 2.3. Vì sao không dùng AppSync (GraphQL subscriptions)

Có xem xét AWS AppSync vì nó quản lý connection tự động, đỡ code hơn API Gateway WebSocket thủ công. Nhưng quyết định **không dùng ở giai đoạn này** vì:
- Plan gốc đã chốt REST là chính, GraphQL "để sau" — thêm AppSync nghĩa là thêm cả 1 hệ GraphQL chỉ để phục vụ 1 use case (subscription)
- API Gateway WebSocket + Lambda tái dùng đúng kỹ năng/stack đã có (Lambda, TypeScript), không phải học thêm resolver GraphQL

Nếu sau này thấy việc tự quản connection registry (DynamoDB) trở nên phức tạp/tốn công bảo trì, có thể revisit AppSync — nhưng không phải ưu tiên MVP.

### 2.4. Connection Registry — dùng DynamoDB, không dùng Aurora

Bảng `ws_connections` (DynamoDB, KHÔNG phải Postgres) vì connection state thay đổi liên tục (connect/disconnect mỗi giây) — không phù hợp với relational DB:

```
PK: matchId       (để query nhanh "ai đang xem trận này")
SK: connectionId
Attributes: userId (nullable, hỗ trợ user ẩn danh xem live),
            connectedAt,
            ttl (auto-expire sau X giờ nếu client không cleanup đúng cách)
```

- `$connect` Lambda: lưu connectionId khi client mở WS
- Client gửi action `subscribe` kèm `matchId` sau khi connect → ghi thêm record vào bảng trên
- `$disconnect` Lambda: xoá connectionId khỏi mọi match đang subscribe
- TTL native của DynamoDB tự dọn rác nếu `$disconnect` không kịp chạy (mất mạng đột ngột)

---

## 3. Thay đổi Schema (so với plan gốc)

### 3.1. Bảng mới: `live_match_state` (Aurora)

Denormalized, đọc siêu nhanh cho REST snapshot + làm nguồn cache Redis, tránh join nhiều bảng mỗi lần client reconnect:

```
live_match_state
├── match_id          (PK, FK -> matches)
├── status             (SCHEDULED | LIVE | HT | FT | POSTPONED | ...)
├── minute
├── home_score
├── away_score
├── last_event_seq     (số thứ tự event cuối cùng đã áp dụng — dùng để dedup/catch-up)
├── updated_at
```

- Redis cache key `live:{matchId}` = serialize của bảng này, TTL ngắn (5-10s), refresh mỗi lần worker ghi
- REST endpoint `/matches/{id}/live` đọc Redis trước, miss thì đọc Aurora

### 3.2. Sửa `match_events`: thêm sequence number

```
match_events
├── ...(giữ nguyên các cột cũ)
├── seq        (int, tăng dần theo match_id, unique theo match_id+seq)
```

Lý do: client khi reconnect WebSocket cần biết "đã nhận tới event nào" để chỉ fetch phần thiếu (`GET /matches/{id}/events?since_seq=42`), tránh replay toàn bộ hoặc miss event.

### 3.3. Bảng mới (DynamoDB, ngoài Aurora): `ws_connections`

Như mô tả ở mục 2.4 — không đưa vào Prisma schema vì đây là bảng ephemeral state, không phải domain data.

### 3.4. Cột mới trên bảng lõi

`external_ref JSONB` trên `matches`, `teams`, `players`, `competitions` (mục 1.2).

---

## 4. Thay đổi API

### 4.1. REST bổ sung

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/matches/live` | List trận đang live, cache Redis TTL ~5s |
| GET | `/matches/{id}/live` | Snapshot hiện tại từ `live_match_state`, dùng khi client mở app hoặc WS reconnect |
| GET | `/matches/{id}/events?since_seq=N` | Catch-up events bị miss trong lúc mất kết nối WS |

### 4.2. WebSocket protocol mới

Endpoint: `wss://api.<domain>/live`

**Client → Server:**
```json
{ "action": "subscribe", "matchId": "123" }
{ "action": "unsubscribe", "matchId": "123" }
```

**Server → Client:**
```json
{ "type": "match.snapshot", "matchId": "123", "data": { ...live_match_state } }
{ "type": "match.event", "matchId": "123", "seq": 43, "data": { ...event } }
{ "type": "match.status_change", "matchId": "123", "status": "FT" }
```

**Flutter client flow:**
1. Mở WS khi vào màn hình chi tiết trận đấu (hoặc màn "Live" list)
2. Gửi `subscribe` với matchId đang xem
3. Nếu WS bị rớt → gọi REST `/matches/{id}/live` + `/matches/{id}/events?since_seq=<last_seq_đã_có>` để bù dữ liệu, sau đó `subscribe` lại
4. Rời màn hình → gửi `unsubscribe` (hoặc đóng WS nếu không còn theo dõi trận nào)

---

## 5. Cập nhật Infra Diagram tổng

```
Flutter App
   │  (REST)                     │ (WebSocket)
   ▼                              ▼
CloudFront ──▶ API Gateway (REST)   API Gateway (WebSocket)
                    │                       │
                    ▼                       ▼
                Hono API              Lambda handlers
                    │                 ($connect/$disconnect/subscribe/ws-push)
        ┌───────────┼──────────┐             │
        ▼           ▼          ▼             ▼
     Aurora       Redis    OpenSearch    DynamoDB (ws_connections)
        │
        ▼
   EventBridge Scheduler ──▶ Step Functions ──▶ Lambda (fetch-live-data)
                                                      │
                                                      ▼
                                            data-provider adapter
                                                      │
                                                      ▼
                                              API-Football (external)
                                                      │
                                            (fan-out) SNS "match-updates"
                                                 ├──▶ Lambda ws-push
                                                 └──▶ Lambda fcm-push ──▶ FCM
                                                      │
                                                      ▼
                                            Bedrock (AI summary — async,
                                            trigger sau khi status=FT)
```

---

## 6. Rollout — thứ tự triển khai đề xuất

1. **Data provider adapter** (`packages/data-provider`) + canonical model — làm trước tiên, mọi thứ khác phụ thuộc vào đây
2. **Sync-worker MVP**: polling cố định đơn giản trước (không cần Step Functions ngay), chạy được `live_match_state` + `match_events` với seq number
3. **REST endpoints live** (`/matches/live`, `/matches/{id}/live`, `/events?since_seq`) — dùng được ngay trên Flutter bằng polling ngắn (2-3s) TRƯỚC KHI build WebSocket — để có sản phẩm chạy được sớm
4. **WebSocket layer** (API Gateway WS + DynamoDB connections) — nâng cấp từ REST polling sang push thật khi REST polling đã chứng minh luồng dữ liệu đúng
5. **Step Functions adaptive polling** — thay cron cố định khi cần tối ưu chi phí (không phải chặn MVP)
6. **FCM push cho favorite teams** — nối vào SNS fan-out đã có sẵn ở bước 4-5

Thứ tự này để mỗi bước đều ra được thứ chạy được (REST polling "giả real-time" đủ tốt cho demo/MVP đầu), tránh việc phải build xong toàn bộ WebSocket infra mới có thể test end-to-end.
