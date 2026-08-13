import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

const teamIdParamSchema = z.object({ teamId: z.string() });
const playerIdParamSchema = z.object({ playerId: z.string() });
const favoriteTeamBodySchema = z.object({ teamId: z.string() });
const favoritePlayerBodySchema = z.object({ playerId: z.string() });

const teamSelect = { id: true, name: true, logoUrl: true } as const;
const playerSelect = { id: true, name: true, position: true, teamId: true } as const;

export const favoritesRoute = new Hono()
  .get("/favorites/teams", requireAuth, async (c) => {
    const userId = c.get("userId");
    const favorites = await prisma.favoriteTeam.findMany({
      where: { userId },
      include: { team: { select: teamSelect } },
      orderBy: { createdAt: "desc" },
    });
    return c.json({ items: favorites.map((f) => f.team) });
  })
  .post("/favorites/teams", requireAuth, zValidator("json", favoriteTeamBodySchema), async (c) => {
    const userId = c.get("userId");
    const { teamId } = c.req.valid("json");

    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) return c.json({ error: "team not found" }, 404);

    const favorite = await prisma.favoriteTeam.upsert({
      where: { userId_teamId: { userId, teamId } },
      create: { userId, teamId },
      update: {},
    });
    return c.json(favorite, 200);
  })
  .delete(
    "/favorites/teams/:teamId",
    requireAuth,
    zValidator("param", teamIdParamSchema),
    async (c) => {
      const userId = c.get("userId");
      const { teamId } = c.req.valid("param");
      await prisma.favoriteTeam.deleteMany({ where: { userId, teamId } });
      return c.body(null, 204);
    },
  )
  .get("/favorites/players", requireAuth, async (c) => {
    const userId = c.get("userId");
    const favorites = await prisma.favoritePlayer.findMany({
      where: { userId },
      include: { player: { select: playerSelect } },
      orderBy: { createdAt: "desc" },
    });
    return c.json({ items: favorites.map((f) => f.player) });
  })
  .post(
    "/favorites/players",
    requireAuth,
    zValidator("json", favoritePlayerBodySchema),
    async (c) => {
      const userId = c.get("userId");
      const { playerId } = c.req.valid("json");

      const player = await prisma.player.findUnique({ where: { id: playerId } });
      if (!player) return c.json({ error: "player not found" }, 404);

      const favorite = await prisma.favoritePlayer.upsert({
        where: { userId_playerId: { userId, playerId } },
        create: { userId, playerId },
        update: {},
      });
      return c.json(favorite, 200);
    },
  )
  .delete(
    "/favorites/players/:playerId",
    requireAuth,
    zValidator("param", playerIdParamSchema),
    async (c) => {
      const userId = c.get("userId");
      const { playerId } = c.req.valid("param");
      await prisma.favoritePlayer.deleteMany({ where: { userId, playerId } });
      return c.body(null, 204);
    },
  );
