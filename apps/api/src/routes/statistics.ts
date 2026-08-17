import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";

// seasonId optional — team/player detail pages (apps/web) không có season-selector riêng (đó là
// việc của /standings), nên khi không truyền seasonId thì trả về mùa giải GẦN NHẤT có
// TeamStatistics/PlayerStatistics cho team/player đó (order by season.startDate desc), thay vì
// bắt caller phải tự biết seasonId nào đang "current".
const statisticsQuerySchema = z.object({ seasonId: z.string().optional() });

export const statisticsRoute = new Hono()
  .get(
    "/statistics/teams/:teamId",
    zValidator("param", z.object({ teamId: z.string() })),
    zValidator("query", statisticsQuerySchema),
    async (c) => {
      const { teamId } = c.req.valid("param");
      const { seasonId } = c.req.valid("query");
      const stats = seasonId
        ? await prisma.teamStatistics.findUnique({ where: { teamId_seasonId: { teamId, seasonId } } })
        : await prisma.teamStatistics.findFirst({
            where: { teamId },
            orderBy: { season: { startDate: "desc" } },
          });
      if (!stats) return c.json({ error: "not found" }, 404);
      return c.json(stats);
    },
  )
  .get(
    "/statistics/players/:playerId",
    zValidator("param", z.object({ playerId: z.string() })),
    zValidator("query", statisticsQuerySchema),
    async (c) => {
      const { playerId } = c.req.valid("param");
      const { seasonId } = c.req.valid("query");
      const stats = seasonId
        ? await prisma.playerStatistics.findUnique({ where: { playerId_seasonId: { playerId, seasonId } } })
        : await prisma.playerStatistics.findFirst({
            where: { playerId },
            orderBy: { season: { startDate: "desc" } },
          });
      if (!stats) return c.json({ error: "not found" }, 404);
      return c.json(stats);
    },
  );
