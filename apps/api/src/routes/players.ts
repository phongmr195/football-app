import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";

export const playersRoute = new Hono()
  .get("/players", zValidator("query", paginationQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid("query");
    const [items, total] = await Promise.all([
      prisma.player.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
        include: { team: { select: { id: true, name: true, logoUrl: true } } },
      }),
      prisma.player.count(),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  .get("/players/:id", zValidator("param", z.object({ id: z.string() })), async (c) => {
    const { id } = c.req.valid("param");
    const player = await prisma.player.findUnique({
      where: { id },
      include: { team: true },
    });
    if (!player) return c.json({ error: "not found" }, 404);
    return c.json(player);
  });
