# Scraper (`apps/scraper-sofascore`)

Docs cho pipeline Sofascore — chỉ load khi làm việc ở đây, `apps/sync-worker/src/*sofascore*.ts`,
`apps/api/src/scraper-*.ts`, hoặc `apps/web/src/app/admin/scraper/`.

## Vì sao Python

Component Python duy nhất trong monorepo. `soccerdata` (qua `tls_requests`) giả mạo TLS fingerprint
để vượt Cloudflare bot-protection của Sofascore — Node `fetch` không làm được việc này. Rủi ro ToS
đã biết và chấp nhận (bypass chủ động, khác API đối tác chính thức).

## Pipeline scrape theo trận (3 bước, giao tiếp qua file JSON, không đụng Postgres từ Python)

1. `generate-sofascore-manifest` (sync-worker) — query match FINISHED + roster 2 đội → `manifest.json`.
2. `python scraper.py manifest.json output/ --data-types <list>` — resolve `game_id`, gọi endpoint Sofascore, khớp tên cầu thủ với roster trong manifest → `output/<matchId>.json`.
3. `ingest-sofascore [outputDir]` (sync-worker) — upsert vào Postgres qua Prisma.

10 loại data (`SCRAPER_DATA_TYPES` ở `apps/api/src/scraper-competitions.ts`, key dùng nguyên văn
xuyên suốt pipeline):

| Type | Model |
|---|---|
| `events` | `MatchEvent` |
| `lineups` | `MatchLineup`/`Formation`/`PlayerRating` |
| `statistics` | `MatchStatistic` |
| `commentary` | `Commentary` |
| `shotmap` | `MatchShot` (xG/toạ độ TỪNG cú sút) |
| `highlights` | `MatchHighlight` (link YouTube) |
| `averagePositions` | `MatchAveragePosition` |
| `momentum` | `MatchMomentum` (`minute` là Float) |
| `odds` | `MatchOdds` (khoá theo `sofascoreMarketId`, không phải `marketName`) |
| `playerSeasonStats` | mở rộng `PlayerStatistics` (season-level, xem dưới) |

Gate "match cần scrape" ĐỘNG theo `dataTypes` đang chọn (OR qua relation tương ứng) — không cố định
theo `events`, để admin backfill riêng 1 loại mới cho match đã có data loại khác.

## Rule khi thêm/sửa `map_*()` trong `scraper.py`

- **Own-goal**: Sofascore's `isHome` phản ánh đội ĐƯỢC LỢI điểm, không phải đội của cầu thủ ghi
  bàn — đảo `isHome` cho case own-goal TRƯỚC khi chọn team/roster trong MỌI hàm `map_*()`.
- **Idempotency khi re-ingest**: có unique constraint tự nhiên (`commentary`/`highlights`/
  `momentum`) → `createMany({skipDuplicates})`; có key ổn định (`averagePositions`/`odds`) → upsert;
  không có gì unique (`shotmap`) → `deleteMany` + `createMany`.

## `match_player()` — khớp tên cầu thủ Sofascore ↔ DB

- Fold tay các ký tự Latin không tự decompose qua NFKD (`ø`/`æ`/`đ`/`ð`/`þ`/`ł`/`ß`/`ț`/`ș`) trước
  khi normalize, không thì bị regex xoá như dấu câu.
- Fallback mononym: 1 bên chỉ có 1 từ VÀ từ đó xuất hiện trong tên đầy đủ bên kia VÀ chỉ đúng 1
  ứng viên → match.
- Fallback họ: so khớp TẬP HỢP mọi từ sau tên đầu (không chỉ từ cuối) — họ đôi TBN/BĐN có thể bị
  Sofascore bỏ họ mẹ ở giữa chuỗi.
- `PLAYER_NAME_ALIASES`/`TEAM_NAME_ALIASES`: nickname không suy được bằng quy tắc chung (vd "Gavi"
  = "Pablo Gavira") — thêm entry khi gặp case thật, không đoán trước.
- Unmatched còn lại thường là data staleness (roster rỗng do football-data.org 403, cầu thủ chuyển
  đội DB chưa cập nhật, cầu thủ trẻ chưa từng được sync) — không phải bug matcher. Roster rỗng gần
  hết 1 đội → nghi staleness trước, không phải lỗi khớp tên.

## Roster backfill từ Sofascore

Gap-fill khi football-data.org trả 403 (team xuống hạng khỏi free-tier). `Player` tạo từ đây có
`externalRef.provider: "sofascore"` — không đụng player đã sync từ football-data.org. 3 bước tương
tự pipeline chính: `generate-roster-backfill-manifest` → `python backfill-roster.py` (resolve team
id qua `/search/all`, lọc `sport.slug=="football"` + gender + tên khớp chính xác + đúng 1 ứng viên)
→ `ingest-sofascore-roster`.

## `playerSeasonStats`

Season-level, khác 9 loại theo trận. 1 request trả 34 category cùng lúc (mỗi category top-50 riêng,
hợp nhất theo Sofascore player id). Mở rộng `PlayerStatistics` có sẵn (field mới đều nullable —
thiếu field = "không có data", khác field cũ `@default(0)`). Ingest CHỈ set field Sofascore thật
quan sát được, không đè giá trị đã có từ football-data.org. Resolve cầu thủ theo roster CẢ GIẢI
(không giới hạn 1 team) vì Sofascore's `team` trong response là team HIỆN TẠI, có thể khác team lúc
đá mùa giải đang xét. Chạy độc lập, không qua `generate-sofascore-manifest.ts` (không theo match).

## Auto-scrape khi match FINISHED

`apps/sync-worker/src/sofascore-match-scrape.ts`'s `scrapeMatchDetailsIfNeeded()` — tự trigger
ĐÚNG 1 LẦN khi match chuyển FINISHED (từ `sync-live-matches.ts` + `sync-catalog.ts`, cùng pattern
`ai_match_summary`), scrape 7 loại (không kèm `commentary`/`odds`, vẫn chỉ scrape tay qua
`/admin/scraper`). Tự build manifest trong memory, không qua HTTP admin API. Chỉ chạy khi env
`SOFASCORE_SCRAPE_ENABLED=true` (Render only — local không có Python/TLS bundle).

Thay cho feature cũ "auto-fetch odds mỗi tick khi LIVE" (`live-odds.ts`, đã xoá) — thất bại 100%
trên Render (nghi IP datacenter bị chặn khác IP nhà), không cần thiết vì data theo trận này không
có áp lực real-time.

**Lỗi log qua subprocess Python: luôn truyền full `stderr` qua `detail` param của `logError`, KHÔNG
cắt vào `message`** — `soccerdata` retry 5 lần rồi mới raise 1 lỗi wrapper chung ở cuối, cắt đuôi
`stderr` sẽ mất hết traceback thật.

## Khác

- Chạy tay/backfill, không tự động theo lịch (trừ auto-scrape ở trên). football-data.org đặt tên
  season theo NĂM BẮT ĐẦU — season "2025" = mùa 2025-2026, không phải "2026" dù có thể đang
  `isCurrent: true`.
- `GET /matches/:id/events` tự trả data thật ngay khi có — không cần sửa API. Chưa có endpoint
  public cho Lineups/Statistics/PlayerRating.
