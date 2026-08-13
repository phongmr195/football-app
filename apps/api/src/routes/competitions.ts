import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";

export const competitionsRoute = new Hono()
  .get("/competitions", zValidator("query", paginationQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid("query");
    const [items, total] = await Promise.all([
      prisma.competition.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
      }),
      prisma.competition.count(),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  .get("/competitions/:id", zValidator("param", z.object({ id: z.string() })), async (c) => {
    const { id } = c.req.valid("param");
    const competition = await prisma.competition.findUnique({
      where: { id },
      include: { seasons: { orderBy: { startDate: "desc" } } },
    });
    if (!competition) return c.json({ error: "not found" }, 404);
    return c.json(competition);
  });
