import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";

const stadiumsQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
});

// KHÔNG có DELETE — Team.stadiumId tham chiếu tới đây, giữ cùng quy ước "không xoá" đã dùng cho
// Competition/Team/Player (xem ghi chú tương tự ở teams.ts) dù quan hệ này không cascade.
const optionalNullableString = () => z.string().optional().transform((v) => (v === "" ? null : v));

const stadiumCreateSchema = z.object({
  name: z.string().min(1),
  city: optionalNullableString(),
  countryCode: optionalNullableString(),
  capacity: z.number().int().nullable().optional(),
});
const stadiumUpdateSchema = stadiumCreateSchema.partial();

export const stadiumsRoute = new Hono()
  .get("/stadiums", zValidator("query", stadiumsQuerySchema), async (c) => {
    const { page, pageSize, search } = c.req.valid("query");
    const where = search ? { name: { contains: search, mode: "insensitive" as const } } : {};
    const [items, total] = await Promise.all([
      prisma.stadium.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
      }),
      prisma.stadium.count({ where }),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  .post("/stadiums", requireAdminSession, zValidator("json", stadiumCreateSchema), async (c) => {
    const data = c.req.valid("json");
    const stadium = await prisma.stadium.create({ data });
    return c.json(stadium, 201);
  })
  .patch(
    "/stadiums/:id",
    requireAdminSession,
    zValidator("param", z.object({ id: z.string() })),
    zValidator("json", stadiumUpdateSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const existing = await prisma.stadium.findUnique({ where: { id } });
      if (!existing) return c.json({ error: "not found" }, 404);
      const stadium = await prisma.stadium.update({ where: { id }, data });
      return c.json(stadium);
    },
  );
