# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable
WORKDIR /repo

# ---- build: install full workspace, generate prisma client, compile ----
FROM base AS build
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @football-app/database db:generate
RUN pnpm turbo run build --filter=@football-app/api...
RUN pnpm --filter=@football-app/api --prod deploy --legacy /deploy/api

# ---- runtime: chỉ chứa output đã deploy, không có source/dev deps ----
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /deploy/api .
EXPOSE 3000
CMD ["node", "dist/index.js"]
