import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";

const teamsQuerySchema = paginationQuerySchema.extend({
  // ROADMAP Phase 4 — trang admin list toàn bộ team (hàng nghìn dòng) không dùng được nếu thiếu
  // tìm kiếm, khác các trang browse công khai vốn luôn lọc theo competition/season trước.
  search: z.string().optional(),
  // Optional — cho trang /admin/team-statistics (2026-08-20): danh sách team KHÔNG lọc theo gì cả
  // là bug thật đã gặp (admin phải tìm giữa hàng nghìn team toàn cầu để chọn 1 đội cho 1 season cụ
  // thể, dễ chọn nhầm đội chưa từng đá season đó -> 400 "no finished matches"). Lọc theo team có
  // ít nhất 1 match (home hoặc away) trong season này.
  seasonId: z.string().optional(),
});

// KHÔNG có DELETE — Team có rất nhiều quan hệ onDelete: Cascade (matches/statistics/lineups/...
// xem schema.prisma), xoá nhầm 1 team sẽ mất rất nhiều data liên quan. Prisma Studio vẫn là
// escape hatch có chủ đích cho xoá thật.
//
// Chuỗi rỗng -> null: xem ghi chú tương tự ở competitions.ts.
const optionalNullableString = () => z.string().optional().transform((v) => (v === "" ? null : v));

const teamCreateSchema = z.object({
  name: z.string().min(1),
  shortName: optionalNullableString(),
  logoUrl: optionalNullableString(),
  countryCode: optionalNullableString(),
  founded: z.number().int().nullable().optional(),
  stadiumId: optionalNullableString(),
});
const teamUpdateSchema = teamCreateSchema.partial();

export const teamsRoute = new Hono()
  .get("/teams", zValidator("query", teamsQuerySchema), async (c) => {
    const { page, pageSize, search, seasonId } = c.req.valid("query");
    const where = {
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
      ...(seasonId
        ? { OR: [{ homeMatches: { some: { seasonId } } }, { awayMatches: { some: { seasonId } } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.team.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
      }),
      prisma.team.count({ where }),
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
  )
  .post("/teams", requireAdminSession, zValidator("json", teamCreateSchema), async (c) => {
    const data = c.req.valid("json");
    const team = await prisma.team.create({ data });
    return c.json(team, 201);
  })
  .patch(
    "/teams/:id",
    requireAdminSession,
    zValidator("param", z.object({ id: z.string() })),
    zValidator("json", teamUpdateSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const existing = await prisma.team.findUnique({ where: { id } });
      if (!existing) return c.json({ error: "not found" }, 404);
      const team = await prisma.team.update({ where: { id }, data });
      return c.json(team);
    },
  );
