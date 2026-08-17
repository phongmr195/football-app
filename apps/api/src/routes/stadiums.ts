import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";

// Chỉ có GET /stadiums ở piece này — cần cho dropdown "Sân vận động" trong form Team
// (apps/web/src/app/admin/teams/page.tsx). CRUD đầy đủ cho Stadium (create/edit/delete) là
// piece tiếp theo của ROADMAP Phase 4, cùng Coach/Referee/Season.
export const stadiumsRoute = new Hono().get(
  "/stadiums",
  zValidator("query", paginationQuerySchema),
  async (c) => {
    const { page, pageSize } = c.req.valid("query");
    const [items, total] = await Promise.all([
      prisma.stadium.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
      }),
      prisma.stadium.count(),
    ]);
    return c.json({ items, page, pageSize, total });
  },
);
