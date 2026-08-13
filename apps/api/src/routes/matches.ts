import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";

const matchesQuerySchema = paginationQuerySchema.extend({
  competitionId: z.string().optional(),
  status: z
    .enum(["SCHEDULED", "LIVE", "HALFTIME", "FINISHED", "POSTPONED", "CANCELLED"])
    .optional(),
});

const teamSelect = { id: true, name: true, logoUrl: true } as const;

export const matchesRoute = new Hono()
  .get("/matches", zValidator("query", matchesQuerySchema), async (c) => {
    const { page, pageSize, competitionId, status } = c.req.valid("query");
    const where = {
      ...(competitionId ? { competitionId } : {}),
      ...(status ? { status } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.match.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { kickoffAt: "asc" },
        include: {
          homeTeam: { select: teamSelect },
          awayTeam: { select: teamSelect },
          competition: { select: { id: true, name: true, logoUrl: true } },
        },
      }),
      prisma.match.count({ where }),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  .get("/matches/:id", zValidator("param", z.object({ id: z.string() })), async (c) => {
    const { id } = c.req.valid("param");
    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        homeTeam: { select: teamSelect },
        awayTeam: { select: teamSelect },
        competition: { select: { id: true, name: true, logoUrl: true } },
        liveState: true,
      },
    });
    if (!match) return c.json({ error: "not found" }, 404);
    return c.json(match);
  });
