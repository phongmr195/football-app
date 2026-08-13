import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";

export const teamsRoute = new Hono()
  .get("/teams", zValidator("query", paginationQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid("query");
    const [items, total] = await Promise.all([
      prisma.team.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
      }),
      prisma.team.count(),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  .get("/teams/:id", zValidator("param", z.object({ id: z.string() })), async (c) => {
    const { id } = c.req.valid("param");
    const team = await prisma.team.findUnique({
      where: { id },
      include: { stadium: true },
    });
    if (!team) return c.json({ error: "not found" }, 404);
    return c.json(team);
  })
  .get(
    "/teams/:id/players",
    zValidator("param", z.object({ id: z.string() })),
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { page, pageSize } = c.req.valid("query");
      const [items, total] = await Promise.all([
        prisma.player.findMany({
          where: { teamId: id },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { name: "asc" },
        }),
        prisma.player.count({ where: { teamId: id } }),
      ]);
      return c.json({ items, page, pageSize, total });
    },
  );
