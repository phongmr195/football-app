import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { publishComment, type MatchCommentAuthor, type MatchCommentBroadcast } from "../lib/redis";

const matchIdParamSchema = z.object({ id: z.string() });
const commentBodySchema = z.object({ content: z.string().trim().min(1).max(500) });

const authorSelect = { id: true, username: true, profile: { select: { displayName: true } } } as const;
type AuthorRow = { id: string; username: string | null; profile: { displayName: string | null } | null };

// @token — cho phép dài hơn username thật (3-20, xem auth.ts's usernameSchema) vì slug từ
// displayName đầy đủ có thể dài hơn nhiều.
const MENTION_RE = /@([a-zA-Z0-9_]{2,40})/g;

function extractMentionTokens(content: string): string[] {
  const tokens = new Set<string>();
  for (const match of content.matchAll(MENTION_RE)) {
    tokens.add(match[1]!.toLowerCase());
  }
  return [...tokens];
}

// Phần lớn user đăng nhập Google/Facebook KHÔNG có username (field đó chỉ set cho đăng ký
// username/password, xem CLAUDE.md § Authentication) — nếu chỉ dùng username thì @mention gần
// như luôn rỗng với đa số user thật (verify thật 2026-08-26: cả 2 tài khoản test đều
// username=null). Fallback: slug từ displayName (bỏ dấu, lowercase, chỉ giữ [a-z0-9]) khi không
// có username.
function slugifyDisplayName(name: string): string {
  return name
    .toLowerCase()
    .replace(/đ/g, "d") // đ không tự decompose qua NFKD, phải fold tay (cùng lớp lỗi đã gặp ở apps/scraper-sofascore/scraper.py)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks (NFKD decomposed)
    .replace(/[^a-z0-9]/g, "");
}

function mentionHandleOf(user: { username: string | null; displayName: string | null }): string | null {
  if (user.username) return user.username;
  if (user.displayName) {
    const slug = slugifyDisplayName(user.displayName);
    if (slug.length >= 2) return slug;
  }
  return null;
}

function toAuthor(user: AuthorRow): MatchCommentAuthor {
  const displayName = user.profile?.displayName ?? null;
  return { id: user.id, displayName, mentionHandle: mentionHandleOf({ username: user.username, displayName }) };
}

// Chỉ tối đa 10 comment/user/60s — chặn spam cơ bản, không cần AppConfig riêng (khác chat's cap,
// đây không tốn phí AI, chỉ cần chặn flood).
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

// @mention chỉ gợi ý/resolve user ĐANG CÙNG CHAT (comment gần đây), không phải BẤT KỲ ai từng
// comment trận này (có thể từ nhiều ngày trước, không còn "đang" ở đó) — không cần hệ thống
// presence riêng qua WebSocket, dùng comment gần đây làm tín hiệu "đang hoạt động" đủ tốt và rẻ.
// Cùng giá trị với apps/web's MatchComments.tsx (client tự lọc để gợi ý autocomplete).
const MENTION_ACTIVE_WINDOW_MS = 30 * 60 * 1000;

export const matchCommentsRoute = new Hono()
  .get("/matches/:id/comments", zValidator("param", matchIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const rows = await prisma.matchComment.findMany({
      where: { matchId: id },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: { user: { select: authorSelect } },
    });
    const items = rows.map((r) => ({
      id: r.id,
      matchId: r.matchId,
      content: r.content,
      mentionedUserIds: r.mentionedUserIds,
      createdAt: r.createdAt.toISOString(),
      author: toAuthor(r.user),
    }));
    return c.json({ items });
  })
  .post(
    "/matches/:id/comments",
    requireAuth,
    zValidator("param", matchIdParamSchema),
    zValidator("json", commentBodySchema),
    async (c) => {
      const { id: matchId } = c.req.valid("param");
      const { content } = c.req.valid("json");
      const userId = c.get("userId");

      const match = await prisma.match.findUnique({ where: { id: matchId }, select: { id: true } });
      if (!match) return c.json({ error: "not found" }, 404);

      const recentCount = await prisma.matchComment.count({
        where: { userId, createdAt: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) } },
      });
      if (recentCount >= RATE_LIMIT_MAX) {
        return c.json({ error: "Bạn đang bình luận quá nhanh, thử lại sau." }, 429);
      }

      // Chỉ resolve @mention thành user ĐANG CÙNG CHAT trận này (comment trong
      // MENTION_ACTIVE_WINDOW_MS gần nhất) — phạm vi tag hẹp, không cho tag bất kỳ user nào trong
      // hệ thống, và không tag nhầm người đã rời khỏi cuộc trò chuyện từ lâu. Match theo
      // mentionHandle (username HOẶC slug displayName, xem mentionHandleOf) — 2 user khác nhau
      // slug trùng nhau (hiếm nhưng có thể, vd cùng tên) thì KHÔNG resolve ai cả (chỉ nhận khi
      // đúng 1 ứng viên, cùng nguyên tắc an toàn đã dùng ở apps/scraper-sofascore's match_player()).
      const mentionTokens = extractMentionTokens(content);
      let mentionedUserIds: string[] = [];
      if (mentionTokens.length > 0) {
        const activeCommenters = await prisma.user.findMany({
          where: { matchComments: { some: { matchId, createdAt: { gte: new Date(Date.now() - MENTION_ACTIVE_WINDOW_MS) } } } },
          select: { id: true, username: true, profile: { select: { displayName: true } } },
        });
        const handleToUserIds = new Map<string, string[]>();
        for (const u of activeCommenters) {
          const handle = mentionHandleOf({ username: u.username, displayName: u.profile?.displayName ?? null });
          if (!handle) continue;
          handleToUserIds.set(handle, [...(handleToUserIds.get(handle) ?? []), u.id]);
        }
        mentionedUserIds = mentionTokens
          .map((token) => handleToUserIds.get(token))
          .filter((ids): ids is string[] => !!ids && ids.length === 1)
          .map((ids) => ids[0]!);
      }

      const created = await prisma.matchComment.create({
        data: { matchId, userId, content, mentionedUserIds },
        include: { user: { select: authorSelect } },
      });

      const payload: MatchCommentBroadcast = {
        id: created.id,
        matchId: created.matchId,
        content: created.content,
        mentionedUserIds: created.mentionedUserIds,
        createdAt: created.createdAt.toISOString(),
        author: toAuthor(created.user),
      };
      void publishComment(payload);

      return c.json(payload, 201);
    },
  );
