import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { tryResolveUserId } from "../middleware/auth";

const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
});

// v1 dùng contains/ILIKE (đủ nhanh cho vài nghìn team/player/competition hiện có) thay vì
// tsvector+GIN — theo nguyên tắc PROJECT_PLAN §7.1 "chỉ thêm hạ tầng khi có nhu cầu thật đo
// được", không build trước khi biết có cần không.
const RESULT_LIMIT = 5;

// Bug thật (2026-08-17, user báo "bị double data"): cùng 1 team/player thật có thể tồn tại 2 row
// riêng biệt trong DB, mỗi row sync từ 1 provider khác nhau (xem CLAUDE.md § Data provider) — vd
// "Bruno Fernandes" xuất hiện 2 lần trong dropdown gợi ý, kèm 2 label vị trí khác hẳn nhau
// ("Midfield" vs "Tiền vệ") vì mỗi provider dùng vocabulary position riêng. Cùng hướng xử lý với
// competitions/matches/standings (luôn lọc `provider=football-data`, xem
// apps/web/src/lib/default-selection.ts's DEFAULT_PROVIDER) — search chỉ nên trả 1 kết quả/thực
// thể thật, không phải theo từng provider.
const PRIMARY_PROVIDER = "football-data";
const primaryProviderOnly = { externalRef: { path: ["provider"], equals: PRIMARY_PROVIDER } };

export const searchRoute = new Hono().get(
  "/search",
  zValidator("query", searchQuerySchema),
  async (c) => {
    const { q } = c.req.valid("query");
    const contains = { contains: q, mode: "insensitive" as const };

    const [teams, players, competitions, userId] = await Promise.all([
      prisma.team.findMany({
        where: { name: contains, ...primaryProviderOnly },
        take: RESULT_LIMIT,
        orderBy: { name: "asc" },
      }),
      prisma.player.findMany({
        where: { name: contains, ...primaryProviderOnly },
        take: RESULT_LIMIT,
        orderBy: { name: "asc" },
        include: { team: { select: { id: true, name: true, logoUrl: true } } },
      }),
      prisma.competition.findMany({
        where: { name: contains, ...primaryProviderOnly },
        take: RESULT_LIMIT,
        orderBy: { name: "asc" },
      }),
      tryResolveUserId(c),
    ]);

    // Fire-and-forget, không chặn response — chỉ ghi log khi đã đăng nhập (search ẩn danh không
    // có userId để tra cứu lại sau nên không có giá trị ghi).
    if (userId) {
      prisma.searchHistory.create({ data: { userId, query: q } }).catch((err) => {
        console.error("search: failed to log search_history", err);
      });
    }

    return c.json({ teams, players, competitions });
  },
);
