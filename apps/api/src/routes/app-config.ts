import { zValidator } from "@hono/zod-validator";
import { Prisma, prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";

// ROADMAP Phase 4 — quản lý feature flags qua UI thay vì Prisma Studio. AppConfig.key là primary
// key thật (không phải cuid `id` như các model khác) — admin tự đặt `key` lúc tạo mới, không có
// khái niệm "id server sinh ra rồi không cho sửa" như Competition/Team/Player.
const optionalNullableString = () => z.string().optional().transform((v) => (v === "" ? null : v));

const configCreateSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  description: optionalNullableString(),
  isEnabled: z.boolean().optional(),
});
const configUpdateSchema = z.object({
  value: z.unknown().optional(),
  description: optionalNullableString(),
  isEnabled: z.boolean().optional(),
});

export const appConfigRoute = new Hono()
  .get("/config", requireAdminSession, async (c) => {
    const items = await prisma.appConfig.findMany({ orderBy: { key: "asc" } });
    return c.json({ items });
  })
  .post("/config", requireAdminSession, zValidator("json", configCreateSchema), async (c) => {
    const { key, ...data } = c.req.valid("json");
    const existing = await prisma.appConfig.findUnique({ where: { key } });
    if (existing) return c.json({ error: "key đã tồn tại" }, 409);
    const config = await prisma.appConfig.create({
      data: { key, ...data, value: data.value as Prisma.InputJsonValue },
    });
    return c.json(config, 201);
  })
  .patch(
    "/config/:key",
    requireAdminSession,
    zValidator("param", z.object({ key: z.string() })),
    zValidator("json", configUpdateSchema),
    async (c) => {
      const { key } = c.req.valid("param");
      const { value, ...rest } = c.req.valid("json");
      const existing = await prisma.appConfig.findUnique({ where: { key } });
      if (!existing) return c.json({ error: "not found" }, 404);
      const config = await prisma.appConfig.update({
        where: { key },
        data: { ...rest, ...(value !== undefined ? { value: value as Prisma.InputJsonValue } : {}) },
      });
      return c.json(config);
    },
  );
