import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";

const refereesQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
});

const optionalNullableString = () => z.string().optional().transform((v) => (v === "" ? null : v));

const refereeCreateSchema = z.object({
  name: z.string().min(1),
  nationality: optionalNullableString(),
});
const refereeUpdateSchema = refereeCreateSchema.partial();

export const refereesRoute = new Hono()
  .get("/referees", zValidator("query", refereesQuerySchema), async (c) => {
    const { page, pageSize, search } = c.req.valid("query");
    const where = search ? { name: { contains: search, mode: "insensitive" as const } } : {};
    const [items, total] = await Promise.all([
      prisma.referee.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
      }),
      prisma.referee.count({ where }),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  .post("/referees", requireAdminSession, zValidator("json", refereeCreateSchema), async (c) => {
    const data = c.req.valid("json");
    const referee = await prisma.referee.create({ data });
    return c.json(referee, 201);
  })
  .patch(
    "/referees/:id",
    requireAdminSession,
    zValidator("param", z.object({ id: z.string() })),
    zValidator("json", refereeUpdateSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const existing = await prisma.referee.findUnique({ where: { id } });
      if (!existing) return c.json({ error: "not found" }, 404);
      const referee = await prisma.referee.update({ where: { id }, data });
      return c.json(referee);
    },
  );
