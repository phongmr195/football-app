import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { cacheGet, cacheSet } from "../lib/redis";

const matchesQuerySchema = paginationQuerySchema.extend({
  competitionId: z.string().optional(),
  seasonId: z.string().optional(),
  status: z
    .enum(["SCHEDULED", "LIVE", "HALFTIME", "FINISHED", "POSTPONED", "CANCELLED"])
    .optional(),
});

const eventsQuerySchema = z.object({
  since_seq: z.coerce.number().int().min(0).default(0),
});

const teamSelect = { id: true, name: true, logoUrl: true } as const;

const LIVE_MATCHES_CACHE_KEY = "matches:live";
const LIVE_MATCHES_CACHE_TTL_SECONDS = 5;

export const matchesRoute = new Hono()
  .get("/matches", zValidator("query", matchesQuerySchema), async (c) => {
    const { page, pageSize, competitionId, seasonId, status } = c.req.valid("query");
    const where = {
      ...(competitionId ? { competitionId } : {}),
      ...(seasonId ? { seasonId } : {}),
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
          competition: { select: { id: true, name: true, logoUrl: true, externalRef: true } },
        },
      }),
      prisma.match.count({ where }),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  // IMPORTANT: "/matches/live" phải đăng ký TRƯỚC "/matches/:id" — nếu đảo thứ tự, route
  // "/matches/:id" (param) có thể "nuốt" mất request tới "/matches/live" bằng cách match
  // literal "live" như thể nó là 1 match id. Đừng reorder khi thêm route mới vào file này.
  .get("/matches/live", async (c) => {
    const cached = await cacheGet<{ items: unknown[] }>(LIVE_MATCHES_CACHE_KEY);
    if (cached) return c.json(cached);

    const items = await prisma.match.findMany({
      where: { status: { in: ["LIVE", "HALFTIME"] } },
      orderBy: { kickoffAt: "asc" },
      include: {
        homeTeam: { select: teamSelect },
        awayTeam: { select: teamSelect },
        competition: { select: { id: true, name: true, logoUrl: true, externalRef: true } },
        liveState: true,
      },
    });

    const response = { items };
    await cacheSet(LIVE_MATCHES_CACHE_KEY, response, LIVE_MATCHES_CACHE_TTL_SECONDS);
    return c.json(response);
  })
  .get("/matches/:id", zValidator("param", z.object({ id: z.string() })), async (c) => {
    const { id } = c.req.valid("param");
    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        homeTeam: { select: teamSelect },
        awayTeam: { select: teamSelect },
        competition: { select: { id: true, name: true, logoUrl: true, externalRef: true } },
        liveState: true,
      },
    });
    if (!match) return c.json({ error: "not found" }, 404);
    return c.json(match);
  })
  .get("/matches/:id/live", zValidator("param", z.object({ id: z.string() })), async (c) => {
    const { id } = c.req.valid("param");
    const liveState = await prisma.liveMatchState.findUnique({ where: { matchId: id } });
    if (!liveState) return c.json({ error: "not found" }, 404);
    return c.json(liveState);
  })
  .get(
    "/matches/:id/events",
    zValidator("param", z.object({ id: z.string() })),
    zValidator("query", eventsQuerySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { since_seq: sinceSeq } = c.req.valid("query");

      const items = await prisma.matchEvent.findMany({
        where: { matchId: id, seq: { gt: sinceSeq } },
        orderBy: { seq: "asc" },
        take: 500,
      });

      const lastSeq = items.length > 0 ? items[items.length - 1]!.seq : sinceSeq;
      return c.json({ items, lastSeq });
    },
  );
