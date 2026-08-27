# syntax=docker/dockerfile:1
FROM node:24-slim AS base
# openssl — KHÔNG có sẵn trên node:20-slim (verify thật: thiếu nó khiến Prisma log warning "failed
# to detect the libssl/openssl version... Defaulting to openssl-1.1.x", tự đoán bừa version thay vì
# biết chắc — rủi ro thật cho engine binary lúc runtime nếu đoán sai). Cần ở CẢ build stage (Prisma
# generate) và runtime stage (Prisma Client thực sự chạy) nên đặt ở base, không phải riêng 1 stage.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

# ---- build: install full workspace, generate prisma client, compile ----
FROM base AS build
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @football-app/database db:generate
RUN pnpm turbo run build --filter=@football-app/sync-worker...
RUN pnpm --filter=@football-app/sync-worker --prod deploy --legacy /deploy/sync-worker

# ---- runtime: chạy một lượt sync rồi exit (mô phỏng Lambda invocation), HOẶC poll.js dài hạn
# (sync-worker-live, xem docker-compose.yml + render.yaml) ----
FROM base AS runtime
ENV NODE_ENV=production

# Debian (glibc) chứ KHÔNG Alpine (musl) — verify thật 2026-08-22: tls_requests's native library
# (Go, dùng để auto-scrape Sofascore khi match FINISHED, xem apps/sync-worker/src/
# sofascore-match-scrape.ts) load lỗi trên musl ("initial-exec TLS resolves to dynamic
# definition", lỗi ELF relocation của binary Go trên musl, KHÔNG liên quan network) — cả bản "xgo"
# (generic) và "alpine" (musl-specific) đều fail, chỉ bản "ubuntu" (glibc) trên node:20-slim mới
# load + gọi Sofascore thật thành công. Đổi base image ảnh hưởng CẢ profile sync-worker 1 lượt
# (docker-compose.yml) — chấp nhận được, Debian slim hỗ trợ Node y hệt Alpine, không phần nào phụ
# thuộc musl.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip curl \
  && rm -rf /var/lib/apt/lists/*

# soccerdata + wrapper-tls-requests (PyPI package name — KHÁC tên import "tls_requests", dễ gõ
# sai) — verify thật cả 2 cài sạch qua prebuilt wheel trên Debian, không cần compile
# (pandas/numpy có sẵn wheel manylinux). Không dùng venv — container chỉ chạy đúng app này,
# --break-system-packages an toàn (không xung đột gì với package hệ thống khác).
RUN pip3 install --break-system-packages --no-cache-dir soccerdata wrapper-tls-requests

# Pre-download TLS native lib ở BUILD time — verify thật: tls_requests's downloader RIÊNG của nó
# không ổn định trong container (nhiều lần fail/treo giữa tải dù curl thẳng URL này chỉ mất 1.4s
# cho đúng 15MB) — bypass hẳn downloader đó bằng TLS_LIBRARY_PATH (escape hatch có sẵn trong
# tls_requests/models/libraries.py's load()), trỏ tới file đã tải sẵn thay vì để lib tự tải lúc
# runtime. Version v1.13.1 khớp wrapper-tls-requests's LATEST_VERSION_TAG_NAME hiện tại (hardcode
# trong chính library đó, không phải version repo này chọn) — nếu sau này lib upgrade version,
# phải đổi URL này theo, verify lại bằng đúng cách đã làm ở đây (xem CLAUDE.md/plan feature này).
RUN curl -sL -o /opt/tls-client.so \
  https://github.com/bogdanfinn/tls-client/releases/download/v1.13.1/tls-client-linux-ubuntu-amd64-1.13.1.so
ENV TLS_LIBRARY_PATH=/opt/tls-client.so

WORKDIR /app
COPY --from=build /deploy/sync-worker .
# scraper.py imports sofascore_tls_patch.py — copy cả 2 (bug thật: quên copy file thứ 2 gây
# ModuleNotFoundError trên Render).
COPY apps/scraper-sofascore/scraper.py apps/scraper-sofascore/sofascore_tls_patch.py ./scraper/

CMD ["node", "dist/local.js"]
