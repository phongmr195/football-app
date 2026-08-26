---
name: add-api-module
description: Scaffold a new REST module in apps/api (route file + Zod validation + mount vào app.ts) theo đúng convention của football-app. Dùng khi cần thêm module API mới (ví dụ /teams, /players, /matches, /standings...) theo danh sách trong docs/architecture/PROJECT_PLAN.md § 5.
---

# Add API Module

Scaffold 1 module REST mới cho `apps/api`, đúng theo convention đã có (xem `apps/api/src/routes/health.ts` làm baseline).

## Bước thực hiện

1. **Xác nhận với user (nếu chưa rõ)**: tên module (ví dụ `teams`), các endpoint cần (list/detail/create/update...), có cần `requireAuth` không.

2. **Tạo file `apps/api/src/routes/<module>.ts`**:
   - Import `Hono`, `zValidator` từ `@hono/zod-validator`, `z` từ `zod`, `prisma` từ `@football-app/database`.
   - Định nghĩa Zod schema cho query/param/body ngay trong file đó (không tách riêng trừ khi schema được tái dùng ở nhiều route).
   - Mỗi handler dùng `zValidator("query"|"param"|"json", schema)` — KHÔNG parse tay bằng `schema.parse()`.
   - Nếu cần auth: import `requireAuth` từ `../middleware/auth`, thêm vào chain trước handler, đọc `c.get("userId")`.
   - Query Prisma trực tiếp trong handler cho route đơn giản; nếu logic phức tạp (nhiều bước, join nhiều bảng), tách ra hàm riêng trong cùng file hoặc `src/services/<module>.ts` nếu được tái dùng ở nhiều route.
   - List endpoint: dùng `paginationQuerySchema`/`PaginatedResult` từ `@football-app/shared` cho query/response shape thống nhất.

   Ví dụ khung (điền lại theo module thật):
   ```ts
   import { Hono } from "hono";
   import { zValidator } from "@hono/zod-validator";
   import { z } from "zod";
   import { prisma } from "@football-app/database";
   import { paginationQuerySchema } from "@football-app/shared";

   export const teamsRoute = new Hono()
     .get("/teams", zValidator("query", paginationQuerySchema), async (c) => {
       const { page, pageSize } = c.req.valid("query");
       const items = await prisma.team.findMany({
         skip: (page - 1) * pageSize,
         take: pageSize,
       });
       return c.json({ items, page, pageSize });
     })
     .get("/teams/:id", zValidator("param", z.object({ id: z.string() })), async (c) => {
       const { id } = c.req.valid("param");
       const team = await prisma.team.findUnique({ where: { id } });
       if (!team) return c.json({ error: "not found" }, 404);
       return c.json(team);
     });
   ```

3. **Mount vào `apps/api/src/app.ts`**: thêm `app.route("/", <module>Route)` cạnh route hiện có.

4. **Verify thật** (đừng skip bước này):
   - `pnpm --filter @football-app/api typecheck`
   - `pnpm --filter @football-app/api lint`
   - Chạy `apps/api` dev thật (đổi PORT nếu 3000 bị chiếm) và `curl` thử endpoint mới để xác nhận response đúng shape, không chỉ dừng ở build pass.

5. Nếu module này cần bảng Prisma mới hoặc field mới, dùng skill `add-prisma-model` TRƯỚC khi viết route.
