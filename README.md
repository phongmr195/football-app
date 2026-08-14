# Football App

Monorepo cho Football App (Web + Hono + AWS). Cấu trúc monorepo, quy ước code, kiến trúc đầy đủ + roadmap: [CLAUDE.md](CLAUDE.md), [docs/architecture/](docs/architecture/).

## Bắt đầu

Thứ tự chuẩn: **Docker** (infra) → **apps/api** → **apps/web**. Mỗi bước phụ thuộc bước trước.

```bash
pnpm install
```

### 1. Docker (Postgres, Redis, Firebase Auth Emulator, apps/api)

```bash
cp .env.example .env   # optional — set API_FOOTBALL_KEY/FOOTBALL_DATA_API_KEY nếu cần sync-worker chạy thật
pnpm docker:up          # postgres + redis + dozzle + firebase-emulator + api
pnpm db:migrate         # chạy migration vào postgres trong docker (từ máy host, DATABASE_URL trỏ localhost:5432)
```

Kiểm tra nhanh: `curl http://localhost:3000/health`. `api` chạy qua Docker tự dùng Firebase Auth Emulator (project giả `demo-football-app`) để verify token — không cần Firebase project thật để test đăng nhập local.

Lệnh khác hay dùng:

```bash
pnpm docker:logs     # mở Dozzle (http://localhost:8080) — xem log tất cả container
pnpm docker:auth-ui  # mở Firebase Emulator UI (http://localhost:4000) — xem/tạo test user
pnpm docker:worker   # chạy sync-worker 1 lượt rồi exit (profile "worker", không tự chạy cùng docker:up)
pnpm docker:down     # dừng + xoá container (giữ volume data)
pnpm docker:test     # test suite cô lập (Postgres riêng, ephemeral, không đụng data dev)
```

Build image production thật (dùng khi deploy lên ECR/ECS — chưa wire vào CI, xem ROADMAP):

```bash
docker build -f apps/api/Dockerfile -t football-app-api .
docker build -f apps/sync-worker/Dockerfile -t football-app-sync-worker .
```

### 2. apps/api

Muốn dev `apps/api` với hot-reload (sửa code thấy hiệu lực ngay, không cần rebuild image) → dừng container `api` trước rồi chạy local, trỏ vào Postgres của Docker:

```bash
docker compose stop api   # tránh xung đột port 3000 với bản chạy local
cp apps/api/.env.example apps/api/.env   # DATABASE_URL trỏ postgresql://postgres:postgres@localhost:5432/football_app
pnpm db:generate
pnpm --filter @football-app/api dev
```

### 3. apps/web

```bash
cp apps/web/.env.example apps/web/.env.local
```

Điền `NEXT_PUBLIC_FIREBASE_*` trong `apps/web/.env.local` bằng config Web app thật (đã đăng ký sẵn trong project `jankara-e2e-test`, xem [CLAUDE.md § Authentication](CLAUDE.md#authentication-firebase-auth)):

```bash
firebase apps:list --project jankara-e2e-test              # lấy app id (platform WEB)
firebase apps:sdkconfig WEB <app-id> --project jankara-e2e-test
```

```bash
pnpm --filter @football-app/web dev     # hoặc pnpm dev để chạy tất cả app qua turbo
```