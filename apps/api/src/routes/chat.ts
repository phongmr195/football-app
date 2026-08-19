import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import type { LlmProvider } from "@football-app/ai-provider";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { createLlmProvider } from "../ai-provider";
import { buildChatContext } from "../chat-retrieval";

// Giá cứng theo model — copy riêng, đúng convention đã lặp lại ở match-summary.ts/
// player-summary.ts/player-compare.ts (2 module độc lập, tránh coupling chỉ vì 1 bảng giá nhỏ).
const PRICE_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "gemini-3.5-flash-lite": { input: 0, output: 0 },
};

function estimateCostUsd(model: string, tokensInput: number, tokensOutput: number): number {
  const price = PRICE_PER_MILLION_TOKENS_USD[model];
  if (!price) return 0;
  return (tokensInput * price.input + tokensOutput * price.output) / 1_000_000;
}

// User-triggered, on-demand (khác ai_match_summary/ai_player_summary — job hệ thống backfill
// trước) — bắt buộc đồng bộ trong request có auth, giống player-compare. AiUsageLog consumer thứ
// 2 (sau player_compare) — cùng pattern cap theo user.
const DAILY_CAP = 30;
const HISTORY_TURNS = 10;

const sendMessageBodySchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1).max(2000),
});

const SYSTEM_PROMPT =
  "Bạn là trợ lý bóng đá. Trả lời câu hỏi của user dựa trên PHẦN DỮ LIỆU được cung cấp (nếu có) và " +
  "lịch sử hội thoại trước đó. CHỈ dựa trên thông tin được cung cấp — nếu không có dữ liệu liên " +
  "quan đến câu hỏi, hãy nói rõ là không có thông tin, KHÔNG bịa số liệu/sự kiện. Trả lời ngắn " +
  "gọn, tự nhiên, bằng tiếng Việt.";

export type SendMessageResult =
  | { status: 429; body: { error: string; limitPerDay: number } }
  | { status: 200; body: { sessionId: string; reply: { content: string; createdAt: Date } } };

// Tách khỏi Hono handler để test inject fake LlmProvider trực tiếp, giống compareTwoPlayers ở
// player-compare.ts.
export async function sendChatMessage(
  userId: string,
  sessionId: string | undefined,
  message: string,
  llmProvider: LlmProvider = createLlmProvider(),
): Promise<SendMessageResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const usedToday = await prisma.aiUsageLog.count({
    where: { userId, feature: "chat", createdAt: { gte: since } },
  });
  if (usedToday >= DAILY_CAP) {
    return { status: 429, body: { error: "chat_limit_exceeded", limitPerDay: DAILY_CAP } };
  }

  const resolvedSessionId = sessionId ?? randomUUID();

  const [context, history] = await Promise.all([
    buildChatContext(message),
    prisma.chatHistory.findMany({
      where: { userId, sessionId: resolvedSessionId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TURNS,
    }),
  ]);
  const historyOldestFirst = [...history].reverse();

  const promptParts: string[] = [];
  if (context) {
    promptParts.push(`Dữ liệu liên quan:\n${context}`);
  }
  if (historyOldestFirst.length > 0) {
    const transcript = historyOldestFirst
      .map((m) => `${m.role === "USER" ? "User" : "Trợ lý"}: ${m.content}`)
      .join("\n");
    promptParts.push(`Lịch sử hội thoại:\n${transcript}`);
  }
  promptParts.push(`Câu hỏi mới của user: ${message}`);

  const result = await llmProvider.generateText({ system: SYSTEM_PROMPT, prompt: promptParts.join("\n\n") });

  const [, assistantMessage] = await prisma.$transaction([
    prisma.chatHistory.create({ data: { userId, sessionId: resolvedSessionId, role: "USER", content: message } }),
    prisma.chatHistory.create({
      data: { userId, sessionId: resolvedSessionId, role: "ASSISTANT", content: result.content },
    }),
  ]);

  await prisma.aiUsageLog.create({
    data: {
      userId,
      feature: "chat",
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      costUsd: estimateCostUsd(result.model, result.tokensInput, result.tokensOutput),
    },
  });

  return {
    status: 200,
    body: { sessionId: resolvedSessionId, reply: { content: assistantMessage.content, createdAt: assistantMessage.createdAt } },
  };
}

const listSessionsQuerySchema = paginationQuerySchema;

export const chatRoute = new Hono()
  .post("/chat/messages", requireAuth, zValidator("json", sendMessageBodySchema), async (c) => {
    const { sessionId, message } = c.req.valid("json");
    const userId = c.get("userId");
    const result = await sendChatMessage(userId, sessionId, message);
    return c.json(result.body, result.status);
  })
  .get("/chat/sessions", requireAuth, zValidator("query", listSessionsQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid("query");
    const userId = c.get("userId");

    // groupBy + orderBy trên aggregate — Prisma hỗ trợ trực tiếp, không cần raw SQL.
    const sessions = await prisma.chatHistory.groupBy({
      by: ["sessionId"],
      where: { userId },
      _max: { createdAt: true },
      _count: { _all: true },
      orderBy: { _max: { createdAt: "desc" } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const totalGroups = await prisma.chatHistory.groupBy({ by: ["sessionId"], where: { userId } });

    return c.json({
      items: sessions.map((s) => ({
        sessionId: s.sessionId,
        lastActivityAt: s._max.createdAt,
        messageCount: s._count._all,
      })),
      page,
      pageSize,
      total: totalGroups.length,
    });
  })
  .get(
    "/chat/sessions/:sessionId/messages",
    requireAuth,
    zValidator("param", z.object({ sessionId: z.string() })),
    async (c) => {
      const { sessionId } = c.req.valid("param");
      const userId = c.get("userId");
      // Luôn filter thêm userId — KHÔNG tin sessionId một mình là biên giới quyền truy cập.
      const messages = await prisma.chatHistory.findMany({
        where: { userId, sessionId },
        orderBy: { createdAt: "asc" },
      });
      return c.json({ items: messages });
    },
  );
