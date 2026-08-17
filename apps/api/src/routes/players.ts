import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";

const playersQuerySchema = paginationQuerySchema.extend({
  // ROADMAP Phase 4 — trang admin list toàn bộ player (hàng chục nghìn dòng) không dùng được
  // nếu thiếu tìm kiếm.
  search: z.string().optional(),
});

// KHÔNG có DELETE — cùng lý do với competitions.ts/teams.ts (onDelete: Cascade, xem schema.prisma).
// Chuỗi rỗng -> null: xem ghi chú tương tự ở competitions.ts (dateOfBirth tự xử lý riêng ở
// toPlayerData bên dưới, "" cũng thành null ở đó).
const optionalNullableString = () => z.string().optional().transform((v) => (v === "" ? null : v));

const playerCreateSchema = z.object({
  name: z.string().min(1),
  dateOfBirth: z.string().optional(), // "YYYY-MM-DD", parse ở dưới trước khi ghi Prisma
  nationality: optionalNullableString(),
  position: optionalNullableString(),
  heightCm: z.number().int().nullable().optional(),
  teamId: optionalNullableString(),
});
const playerUpdateSchema = playerCreateSchema.partial();

// Generic trên `T` để giữ đúng độ "bắt buộc" của field `name` theo schema gọi vào (create: bắt
// buộc, update: optional) — nếu type cứng theo playerUpdateSchema, Prisma sẽ từ chối
// PlayerUncheckedCreateInput vì thấy `name` optional dù lúc runtime chắc chắn có (do
// playerCreateSchema.min(1) đã validate).
function toPlayerData<T extends { dateOfBirth?: string }>(
  input: T,
): Omit<T, "dateOfBirth"> & { dateOfBirth?: Date | null } {
  const { dateOfBirth, ...rest } = input;
  return {
    ...rest,
    ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null } : {}),
  } as Omit<T, "dateOfBirth"> & { dateOfBirth?: Date | null };
}

export const playersRoute = new Hono()
  .get("/players", zValidator("query", playersQuerySchema), async (c) => {
    const { page, pageSize, search } = c.req.valid("query");
    const where = search ? { name: { contains: search, mode: "insensitive" as const } } : {};
    const [items, total] = await Promise.all([
      prisma.player.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
        include: { team: { select: { id: true, name: true, logoUrl: true } } },
      }),
      prisma.player.count({ where }),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  .get("/players/:id", zValidator("param", z.object({ id: z.string() })), async (c) => {
    const { id } = c.req.valid("param");
    const player = await prisma.player.findUnique({
      where: { id },
      include: { team: true },
    });
    if (!player) return c.json({ error: "not found" }, 404);
    return c.json(player);
  })
  .post("/players", requireAdminSession, zValidator("json", playerCreateSchema), async (c) => {
    const data = c.req.valid("json");
    const player = await prisma.player.create({ data: toPlayerData(data) });
    return c.json(player, 201);
  })
  .patch(
    "/players/:id",
    requireAdminSession,
    zValidator("param", z.object({ id: z.string() })),
    zValidator("json", playerUpdateSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const existing = await prisma.player.findUnique({ where: { id } });
      if (!existing) return c.json({ error: "not found" }, 404);
      const player = await prisma.player.update({ where: { id }, data: toPlayerData(data) });
      return c.json(player);
    },
  );
