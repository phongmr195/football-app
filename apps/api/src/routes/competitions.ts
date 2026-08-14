import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";

const competitionsQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  countryCode: z.string().optional(),
  hasMatches: z.coerce.boolean().optional(),
  // Lọc theo data provider (externalRef.provider) — cần vì cùng 1 giải thật (vd Premier League)
  // có thể tồn tại 2 row riêng biệt, mỗi row từ 1 provider khác nhau (xem CLAUDE.md § Data
  // provider). Dùng để loại trùng ở dropdown filter phía web khi cần chỉ lấy data từ 1 provider.
  provider: z.string().optional(),
});

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
  });
