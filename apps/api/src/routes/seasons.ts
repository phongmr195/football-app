import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";

const seasonsQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
});

// KHÔNG có DELETE — Season có onDelete: Cascade lên rất nhiều bảng con (matches/standings/
// teamStatistics/...), cùng lý do với Competition/Team ở competitions.ts/teams.ts.
const seasonCreateSchema = z.object({
  competitionId: z.string().min(1),
  name: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  isCurrent: z.boolean().optional(),
});
const seasonUpdateSchema = seasonCreateSchema.partial();

export const seasonsRoute = new Hono()
  .get("/seasons", zValidator("query", seasonsQuerySchema), async (c) => {
    const { page, pageSize, search } = c.req.valid("query");
    const where = search ? { name: { contains: search, mode: "insensitive" as const } } : {};
    const [items, total] = await Promise.all([
      prisma.season.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { startDate: "desc" },
        include: { competition: { select: { id: true, name: true } } },
      }),
      prisma.season.count({ where }),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  .post("/seasons", requireAdminSession, zValidator("json", seasonCreateSchema), async (c) => {
    const data = c.req.valid("json");
    const season = await prisma.season.create({ data });
    return c.json(season, 201);
  })
  .patch(
    "/seasons/:id",
    requireAdminSession,
    zValidator("param", z.object({ id: z.string() })),
    zValidator("json", seasonUpdateSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const existing = await prisma.season.findUnique({ where: { id } });
      if (!existing) return c.json({ error: "not found" }, 404);
      const season = await prisma.season.update({ where: { id }, data });
      return c.json(season);
    },
  );
