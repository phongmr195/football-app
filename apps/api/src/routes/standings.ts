import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";

// Không phân trang — bảng xếp hạng 1 season vốn nhỏ (thường ~18-24 dòng), trả nguyên bảng.
export const standingsRoute = new Hono().get(
  "/standings",
  zValidator("query", z.object({ seasonId: z.string() })),
  async (c) => {
    const { seasonId } = c.req.valid("query");
    const items = await prisma.standing.findMany({
      where: { seasonId },
      orderBy: { position: "asc" },
      include: { team: { select: { id: true, name: true, logoUrl: true } } },
    });
    return c.json({ items });
  },
);
