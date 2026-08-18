import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { cacheGet, cacheSet } from "../lib/redis";
import { requireAdminSession } from "../middleware/admin-auth";

const MATCH_STATUS_VALUES = ["SCHEDULED", "LIVE", "HALFTIME", "FINISHED", "POSTPONED", "CANCELLED"] as const;

const matchesQuerySchema = paginationQuerySchema.extend({
  competitionId: z.string().optional(),
  seasonId: z.string().optional(),
  status: z.enum(MATCH_STATUS_VALUES).optional(),
  // Comma-separated Team.id list — trận mà 1 trong các team này đá sân nhà HOẶC sân khách. Dùng
  // cho dashboard trang chủ (upcoming/recent matches của các đội yêu thích), 1 request cho nhiều
  // team thay vì N request riêng lẻ.
  teamIds: z.string().optional(),
  // ROADMAP Phase 4 — trang admin quản lý Match cần tìm theo tên đội (không có picker team id sẵn
  // như teamIds ở trên, admin gõ tên trực tiếp).
  search: z.string().optional(),
  // "asc" (mặc định, không đổi hành vi cũ) cho upcoming (SCHEDULED, gần nhất trước); "desc" cho
  // recent results (FINISHED, mới nhất trước) — dashboard cần cả 2 chiều từ cùng 1 endpoint.
  order: z.enum(["asc", "desc"]).default("asc"),
});

const matchUpdateSchema = z.object({
  kickoffAt: z.coerce.date().optional(),
  status: z.enum(MATCH_STATUS_VALUES).optional(),
  homeScore: z.number().int().nullable().optional(),
  awayScore: z.number().int().nullable().optional(),
});

const liveStateUpsertSchema = z.object({
  status: z.enum(MATCH_STATUS_VALUES),
  minute: z.number().int().nullable().optional(),
  homeScore: z.number().int().default(0),
  awayScore: z.number().int().default(0),
  lastEventSeq: z.number().int().default(0),
});

const eventsQuerySchema = z.object({
  since_seq: z.coerce.number().int().min(0).default(0),
});

const teamSelect = { id: true, name: true, logoUrl: true } as const;

const LIVE_MATCHES_CACHE_KEY = "matches:live";
const LIVE_MATCHES_CACHE_TTL_SECONDS = 5;

export const matchesRoute = new Hono()
  .get("/matches", zValidator("query", matchesQuerySchema), async (c) => {
    const { page, pageSize, competitionId, seasonId, status, teamIds, search, order } = c.req.valid("query");
    const teamIdList = teamIds
      ?.split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    // AND của các điều kiện độc lập (một số điều kiện tự dùng OR bên trong) — tránh xung đột khi
    // cả teamIds và search đều dùng khoá "OR" (2 filter khác mục đích: teamIds là dashboard lọc
    // theo id đội yêu thích, search là admin gõ tên đội tự do).
    const where = {
      AND: [
        competitionId ? { competitionId } : {},
        seasonId ? { seasonId } : {},
        status ? { status } : {},
        teamIdList?.length
          ? { OR: [{ homeTeamId: { in: teamIdList } }, { awayTeamId: { in: teamIdList } }] }
          : {},
        search
          ? {
              OR: [
                { homeTeam: { name: { contains: search, mode: "insensitive" as const } } },
                { awayTeam: { name: { contains: search, mode: "insensitive" as const } } },
              ],
            }
          : {},
      ],
    };
    const [items, total] = await Promise.all([
      prisma.match.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { kickoffAt: order },
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
        aiSummary: { select: { content: true, model: true, createdAt: true } },
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
  // ROADMAP Phase 4 — admin sửa tay tỉ số/trạng thái/lịch trận đấu, thay cho Prisma Studio.
  .patch(
    "/matches/:id",
    requireAdminSession,
    zValidator("param", z.object({ id: z.string() })),
    zValidator("json", matchUpdateSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const existing = await prisma.match.findUnique({ where: { id } });
      if (!existing) return c.json({ error: "not found" }, 404);
      const match = await prisma.match.update({ where: { id }, data });
      return c.json(match);
    },
  )
  // Upsert tay LiveMatchState — thay cho việc tự set qua Prisma Studio mỗi lần cần test trận live
  // (đã làm việc này nhiều lần thủ công ở Phase 2, xem ROADMAP Phase 4 checklist).
  .put(
    "/matches/:id/live",
    requireAdminSession,
    zValidator("param", z.object({ id: z.string() })),
    zValidator("json", liveStateUpsertSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const match = await prisma.match.findUnique({ where: { id } });
      if (!match) return c.json({ error: "not found" }, 404);
      const liveState = await prisma.liveMatchState.upsert({
        where: { matchId: id },
        create: { matchId: id, ...data },
        update: data,
      });
      return c.json(liveState);
    },
  )
  .get(
    "/matches/:id/events",
    zValidator("param", z.object({ id: z.string() })),
    zValidator("query", eventsQuerySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { since_seq: sinceSeq } = c.req.valid("query");

      // Kèm player/relatedPlayer/team (chỉ id+name) — thiếu field này khiến web chỉ hiện được
      // loại event + phút, không biết AI ghi bàn/bị thẻ/vào sân (bug thật, verify 2026-08-18).
      const items = await prisma.matchEvent.findMany({
        where: { matchId: id, seq: { gt: sinceSeq } },
        orderBy: { seq: "asc" },
        take: 500,
        include: {
          player: { select: { id: true, name: true } },
          relatedPlayer: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
        },
      });

      const lastSeq = items.length > 0 ? items[items.length - 1]!.seq : sinceSeq;
      return c.json({ items, lastSeq });
    },
  )
  // Nguồn: apps/scraper-sofascore (xem CLAUDE.md § Scraper) — chỉ có data cho match đã scrape
  // (Premier League 2025-2026, chưa full mùa). Trả cấu trúc rỗng hợp lệ (KHÔNG 404) khi match tồn
  // tại nhưng chưa có lineup, để web render empty-state thay vì phải tự xử lý lỗi.
  .get("/matches/:id/lineups", zValidator("param", z.object({ id: z.string() })), async (c) => {
    const { id } = c.req.valid("param");
    const match = await prisma.match.findUnique({
      where: { id },
      select: { homeTeamId: true, awayTeamId: true },
    });
    if (!match) return c.json({ error: "not found" }, 404);

    const [lineups, ratings, formations] = await Promise.all([
      prisma.matchLineup.findMany({
        where: { matchId: id },
        include: { player: { select: { id: true, name: true } } },
      }),
      prisma.playerRating.findMany({ where: { matchId: id } }),
      prisma.formation.findMany({ where: { matchId: id } }),
    ]);
    const ratingByPlayerId = new Map(ratings.map((r) => [r.playerId, r.rating]));
    const formationByTeamId = new Map(formations.map((f) => [f.teamId, f.formation]));

    const buildSide = (teamId: string) => ({
      teamId,
      formation: formationByTeamId.get(teamId) ?? null,
      players: lineups
        .filter((l) => l.teamId === teamId)
        .sort((a, b) => Number(b.isStarting) - Number(a.isStarting))
        .map((l) => ({
          playerId: l.playerId,
          name: l.player.name,
          position: l.position,
          shirtNumber: l.shirtNumber,
          isStarting: l.isStarting,
          rating: ratingByPlayerId.get(l.playerId) ?? null,
        })),
    });

    return c.json({ home: buildSide(match.homeTeamId), away: buildSide(match.awayTeamId) });
  })
  // Field đã model hoá (shotsOnGoal/corners/fouls/offsides) hầu hết rỗng trong data thật (verify
  // 2026-08-18) — trả cả `raw` (toàn bộ groups/statisticsItems từ Sofascore) để web tự render
  // generic, không phụ thuộc field nào được map đủ.
  .get("/matches/:id/statistics", zValidator("param", z.object({ id: z.string() })), async (c) => {
    const { id } = c.req.valid("param");
    const match = await prisma.match.findUnique({
      where: { id },
      select: { homeTeamId: true, awayTeamId: true },
    });
    if (!match) return c.json({ error: "not found" }, 404);

    const stats = await prisma.matchStatistic.findMany({ where: { matchId: id } });
    const byTeamId = new Map(stats.map((s) => [s.teamId, s]));

    return c.json({
      home: byTeamId.get(match.homeTeamId) ?? null,
      away: byTeamId.get(match.awayTeamId) ?? null,
    });
  });
