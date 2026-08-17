import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";

const competitionsQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  countryCode: z.string().optional(),
  hasMatches: z.coerce.boolean().optional(),
  // Lọc theo data provider (externalRef.provider) — cần vì cùng 1 giải thật (vd Premier League)
  // có thể tồn tại 2 row riêng biệt, mỗi row từ 1 provider khác nhau (xem CLAUDE.md § Data
  // provider). Dùng để loại trùng ở dropdown filter phía web khi cần chỉ lấy data từ 1 provider.
  provider: z.string().optional(),
});

// ROADMAP Phase 4 — admin CRUD. KHÔNG có DELETE: Season (và mọi thứ bên dưới nó) có
// onDelete: Cascade lên Competition trong schema.prisma, xoá nhầm 1 giải sẽ kéo theo mất hết
// season/standings/matches — Prisma Studio vẫn là escape hatch có chủ đích cho xoá thật.
//
// Chuỗi rỗng -> null (không phải giữ nguyên/bỏ qua) — admin xoá trắng 1 field trong form nghĩa
// là "xoá giá trị sai này đi", không phải "không đổi gì". Nếu để mặc định z.string().optional()
// thôi thì "" sẽ bị coi là giá trị hợp lệ và LƯU THẲNG "" vào DB thay vì null.
const optionalNullableString = () => z.string().optional().transform((v) => (v === "" ? null : v));

const competitionCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["LEAGUE", "CUP", "INTERNATIONAL"]),
  countryCode: optionalNullableString(),
  logoUrl: optionalNullableString(),
});
const competitionUpdateSchema = competitionCreateSchema.partial();

export const competitionsRoute = new Hono()
  .get("/competitions", zValidator("query", competitionsQuerySchema), async (c) => {
    const { page, pageSize, search, countryCode, hasMatches, provider } = c.req.valid("query");
    const where = {
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
      ...(countryCode ? { countryCode } : {}),
      ...(hasMatches ? { matches: { some: {} } } : {}),
      ...(provider ? { externalRef: { path: ["provider"], equals: provider } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.competition.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
      }),
      prisma.competition.count({ where }),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  .get("/competitions/countries", async (c) => {
    const rows = await prisma.competition.findMany({
      where: { countryCode: { not: null } },
      select: { countryCode: true },
      distinct: ["countryCode"],
      orderBy: { countryCode: "asc" },
    });
    const items = rows.map((row) => row.countryCode as string);
    return c.json({ items });
  })
  .get("/competitions/:id", zValidator("param", z.object({ id: z.string() })), async (c) => {
    const { id } = c.req.valid("param");
    const competition = await prisma.competition.findUnique({
      where: { id },
      include: { seasons: { orderBy: { startDate: "desc" } } },
    });
    if (!competition) return c.json({ error: "not found" }, 404);
    return c.json(competition);
  })
  .post("/competitions", requireAdminSession, zValidator("json", competitionCreateSchema), async (c) => {
    const data = c.req.valid("json");
    const competition = await prisma.competition.create({ data });
    return c.json(competition, 201);
  })
  .patch(
    "/competitions/:id",
    requireAdminSession,
    zValidator("param", z.object({ id: z.string() })),
    zValidator("json", competitionUpdateSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const existing = await prisma.competition.findUnique({ where: { id } });
      if (!existing) return c.json({ error: "not found" }, 404);
      const competition = await prisma.competition.update({ where: { id }, data });
      return c.json(competition);
    },
  );
