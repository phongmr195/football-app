import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";

const coachesQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
});

const optionalNullableString = () => z.string().optional().transform((v) => (v === "" ? null : v));

const coachCreateSchema = z.object({
  name: z.string().min(1),
  nationality: optionalNullableString(),
  birthDate: z.string().optional(),
  teamId: optionalNullableString(),
});
const coachUpdateSchema = coachCreateSchema.partial();

// `birthDate` đến từ form dưới dạng "YYYY-MM-DD" (input text, giống dateOfBirth ở players.ts) —
// cần convert sang Date trước khi Prisma nhận, generic để giữ đúng required/optional-ness của
// caller (xem toPlayerData ở players.ts cho lý do phải làm generic thay vì ép kiểu 1 schema).
function toCoachData<T extends { birthDate?: string }>(
  input: T,
): Omit<T, "birthDate"> & { birthDate?: Date | null } {
  const { birthDate, ...rest } = input;
  return {
    ...rest,
    ...(birthDate !== undefined ? { birthDate: birthDate ? new Date(birthDate) : null } : {}),
  } as Omit<T, "birthDate"> & { birthDate?: Date | null };
}

export const coachesRoute = new Hono()
  .get("/coaches", zValidator("query", coachesQuerySchema), async (c) => {
    const { page, pageSize, search } = c.req.valid("query");
    const where = search ? { name: { contains: search, mode: "insensitive" as const } } : {};
    const [items, total] = await Promise.all([
      prisma.coach.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
        include: { team: { select: { id: true, name: true } } },
      }),
      prisma.coach.count({ where }),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  .post("/coaches", requireAdminSession, zValidator("json", coachCreateSchema), async (c) => {
    const data = c.req.valid("json");
    const coach = await prisma.coach.create({ data: toCoachData(data) });
    return c.json(coach, 201);
  })
  .patch(
    "/coaches/:id",
    requireAdminSession,
    zValidator("param", z.object({ id: z.string() })),
    zValidator("json", coachUpdateSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const existing = await prisma.coach.findUnique({ where: { id } });
      if (!existing) return c.json({ error: "not found" }, 404);
      const coach = await prisma.coach.update({ where: { id }, data: toCoachData(data) });
      return c.json(coach);
    },
  );
