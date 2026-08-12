# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable
WORKDIR /repo

# ---- build: install full workspace, generate prisma client, compile ----
FROM base AS build
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @football-app/database db:generate
RUN pnpm turbo run build --filter=@football-app/sync-worker...
RUN pnpm --filter=@football-app/sync-worker --prod deploy --legacy /deploy/sync-worker

# ---- runtime: chạy một lượt sync rồi exit (mô phỏng Lambda invocation) ----
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /deploy/sync-worker .
CMD ["node", "dist/local.js"]
