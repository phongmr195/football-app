# apps/scraper-sofascore

Component **Python đầu tiên** trong monorepo (mọi thứ khác là Node/TypeScript) — scrape
Events/Lineups/Player ratings/Match statistics từ Sofascore, dùng thư viện
[`soccerdata`](https://github.com/probberechts/soccerdata). Không nằm trong pnpm workspace, không
chạy qua `pnpm turbo run` — xem `CLAUDE.md § Scraper (Sofascore)` cho lý do kiến trúc đầy đủ (tóm
tắt: `soccerdata` bypass Cloudflare bằng cách giả mạo TLS fingerprint của browser thật qua thư viện
`tls_requests`, không có cách nào tái tạo bằng Node `fetch` gốc).

**Đọc kỹ trước khi chạy**: kỹ thuật này chủ động vượt cơ chế chống bot của Sofascore — có rủi ro
ToS thật, và có thể gãy bất cứ lúc nào nếu Sofascore đổi cơ chế bảo vệ. Đã verify hoạt động thật
tại thời điểm viết (2026-08-18).

## Setup

```bash
cd apps/scraper-sofascore
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Chạy (pipeline 3 bước, xem `apps/sync-worker` cho 2 bước còn lại)

```bash
# Bước 1 (Node) — sinh manifest.json từ Postgres (match FINISHED cần scrape + roster 2 đội)
pnpm --filter @football-app/sync-worker generate-sofascore-manifest --limit 5

# Bước 2 (Python) — scrape Sofascore, ghi output/<matchId>.json
source .venv/bin/activate
python scraper.py manifest.json output/

# Bước 3 (Node) — đọc output/, ghi vào Postgres qua Prisma
pnpm --filter @football-app/sync-worker ingest-sofascore
```

`manifest.json`/`output/`/`.venv`/`.cache` đều gitignored — không commit.
