import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";

const seasonQuerySchema = z.object({ seasonId: z.string() });

export const statisticsRoute = new Hono()
  .get(
    "/statistics/teams/:teamId",
    zValidator("param", z.object({ teamId: z.string() })),
    zValidator("query", seasonQuerySchema),
    async (c) => {
      const { teamId } = c.req.valid("param");
      const { seasonId } = c.req.valid("query");
      const stats = await prisma.teamStatistics.findUnique({
        where: { teamId_seasonId: { teamId, seasonId } },
      });
      if (!stats) return c.json({ error: "not found" }, 404);
      return c.json(stats);
    },
  )
  .get(
    "/statistics/players/:playerId",
    zValidator("param", z.object({ playerId: z.string() })),
    zValidator("query", seasonQuerySchema),
    async (c) => {
      const { playerId } = c.req.valid("param");
      const { seasonId } = c.req.valid("query");
      const stats = await prisma.playerStatistics.findUnique({
        where: { playerId_seasonId: { playerId, seasonId } },
      });
      if (!stats) return c.json({ error: "not found" }, 404);
      return c.json(stats);
    },
  );
