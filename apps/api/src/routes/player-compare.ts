import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import type { LlmProvider } from "@football-app/ai-provider";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { createLlmProvider } from "../ai-provider";

// Giá cứng theo model — copy riêng từ apps/sync-worker's match-summary.ts/player-summary.ts (2
// module độc lập, tránh coupling chỉ vì 1 bảng giá nhỏ). Cập nhật đồng thời nếu đổi model mặc định.
const PRICE_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "gemini-3.5-flash-lite": { input: 0, output: 0 },
};

function estimateCostUsd(model: string, tokensInput: number, tokensOutput: number): number {
  const price = PRICE_PER_MILLION_TOKENS_USD[model];
  if (!price) return 0;
  return (tokensInput * price.input + tokensOutput * price.output) / 1_000_000;
}

// Lịch sử "user X đã xem cặp nào" — tách khỏi AiPlayerComparison (cache CHUNG, không gắn user).
// Bump viewedAt cả khi cache hit (user vẫn vừa xem lại cặp này) — KHÔNG tính vào AiUsageLog cap
// (cap chỉ tính LLM call thật, xem compareTwoPlayers).
async function recordHistoryView(userId: string, comparisonId: string): Promise<void> {
  await prisma.playerCompareHistory.upsert({
    where: { userId_comparisonId: { userId, comparisonId } },
    create: { userId, comparisonId },
    update: { viewedAt: new Date() },
  });
}

// Khác ai_player_summary (job hệ thống, backfill trước, không có user để gán quota): user tự chọn
// cặp cầu thủ bất kỳ nên KHÔNG backfill được — bắt buộc on-demand, đồng bộ trong request có auth.
// Đây là route DUY NHẤT trong apps/api gọi LLM trực tiếp (phá lệ "apps/api không phụ thuộc
// @football-app/ai-provider" có chủ đích — xem ROADMAP Phase 5 + plan piece này) vì đây là hành
// động user tự bấm nút, không phải page load passive như match/player summary đang bảo vệ.
const COMPARE_TTL_DAYS = 7;
const DAILY_CAP = 20;

const compareBodySchema = z
  .object({ playerAId: z.string(), playerBId: z.string() })
  .refine((d) => d.playerAId !== d.playerBId, { message: "playerAId và playerBId phải khác nhau" });

type PlayerForCompare = Awaited<ReturnType<typeof loadPlayerForCompare>>;

async function loadPlayerForCompare(playerId: string) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { team: { select: { id: true, name: true, logoUrl: true } } },
  });
  if (!player) return { player: null, stats: null };

  // Mùa gần nhất có data — cùng pattern GET /statistics/players/:id (routes/statistics.ts) khi
  // không truyền seasonId. 2 cầu thủ có thể rơi vào 2 mùa/giải khác nhau (mỗi người lấy riêng,
  // không đồng bộ) — buildComparePrompt() xử lý việc này ở phần prompt.
  const stats = await prisma.playerStatistics.findFirst({
    where: { playerId },
    orderBy: { season: { startDate: "desc" } },
    include: { season: { include: { competition: true } } },
  });
  return { player, stats: stats && stats.appearances > 0 ? stats : null };
}

function toSide(entry: PlayerForCompare) {
  const { player, stats } = entry;
  return {
    id: player!.id,
    name: player!.name,
    position: player!.position,
    team: player!.team,
    statistics: stats
      ? {
          appearances: stats.appearances,
          goals: stats.goals,
          assists: stats.assists,
          yellowCards: stats.yellowCards,
          redCards: stats.redCards,
          minutesPlayed: stats.minutesPlayed,
        }
      : null,
  };
}

function buildComparePrompt(a: PlayerForCompare, b: PlayerForCompare): { system: string; prompt: string } {
  function describe(entry: PlayerForCompare, label: string): string {
    const { player, stats } = entry;
    const team = player!.team ? `, đội ${player!.team.name}` : "";
    const position = player!.position ? ` (${player!.position})` : "";
    const seasonInfo = stats ? `${stats.season.competition.name}, mùa ${stats.season.name}` : "chưa rõ";
    const line = stats
      ? `${stats.appearances} trận, ${stats.goals} bàn thắng, ${stats.assists} kiến tạo, ` +
        `${stats.yellowCards} thẻ vàng, ${stats.redCards} thẻ đỏ`
      : "chưa có số liệu";
    return `${label}: ${player!.name}${position}${team}. Giải đấu/mùa: ${seasonInfo}. Thống kê: ${line}.`;
  }

  return {
    system:
      "Bạn là biên tập viên thể thao. So sánh 2 cầu thủ bóng đá dựa trên số liệu mùa giải gần nhất " +
      "của mỗi người — số liệu này có thể thuộc mùa/giải đấu khác nhau giữa 2 người, nếu vậy hãy nêu " +
      "rõ sự khác biệt đó khi so sánh. Viết nhận xét khách quan, ngắn gọn (4-6 câu) bằng tiếng Việt, " +
      "nêu điểm mạnh tương đối của mỗi người. Chỉ dựa trên thông tin được cung cấp — KHÔNG bịa thêm " +
      "chi tiết ngoài dữ liệu, KHÔNG so sánh kỹ thuật/phong cách chơi vì không có dữ liệu đó.",
    prompt: [describe(a, "Cầu thủ A"), describe(b, "Cầu thủ B")].join("\n"),
  };
}

export type CompareResult =
  | { status: 404; body: { error: string; playerId: string } }
  | { status: 422; body: { error: string; playerId: string } }
  | { status: 429; body: { error: string; limitPerDay: number } }
  | {
      status: 200;
      body: {
        playerA: ReturnType<typeof toSide>;
        playerB: ReturnType<typeof toSide>;
        comparison: { content: string; model: string; createdAt: Date };
        cached: boolean;
      };
    };

// Tách khỏi Hono handler để test inject fake LlmProvider trực tiếp (Hono handler không có chỗ
// cho DI param thứ 2 kiểu generatePlayerSummaryIfNeeded ở sync-worker).
export async function compareTwoPlayers(
  playerAId: string,
  playerBId: string,
  userId: string,
  llmProvider: LlmProvider = createLlmProvider(),
): Promise<CompareResult> {
  // Canonical order — (X,Y) và (Y,X) luôn map về đúng 1 row, không dựa vào caller gửi đúng thứ tự.
  const loId = playerAId < playerBId ? playerAId : playerBId;
  const hiId = playerAId < playerBId ? playerBId : playerAId;

  const [a, b] = await Promise.all([loadPlayerForCompare(loId), loadPlayerForCompare(hiId)]);
  if (!a.player) return { status: 404, body: { error: "player not found", playerId: loId } };
  if (!b.player) return { status: 404, body: { error: "player not found", playerId: hiId } };

  const existing = await prisma.aiPlayerComparison.findUnique({
    where: { playerAId_playerBId: { playerAId: loId, playerBId: hiId } },
  });
  const isFresh =
    existing && Date.now() - existing.createdAt.getTime() < COMPARE_TTL_DAYS * 24 * 60 * 60 * 1000;

  // Cache hit KHÔNG tính vào cap — đọc kết quả đã sinh sẵn không tốn LLM call nào, tính quota vào
  // đây là vô lý (2 user so sánh cùng 1 cặp phổ biến, hoặc 1 user xem lại kết quả cũ, sẽ bị trừ
  // quota cho việc không tốn chi phí gì).
  if (existing && isFresh) {
    await recordHistoryView(userId, existing.id);
    return {
      status: 200,
      body: {
        playerA: toSide(a),
        playerB: toSide(b),
        comparison: { content: existing.content, model: existing.model, createdAt: existing.createdAt },
        cached: true,
      },
    };
  }

  if (!a.stats) return { status: 422, body: { error: "player_missing_statistics", playerId: loId } };
  if (!b.stats) return { status: 422, body: { error: "player_missing_statistics", playerId: hiId } };

  // Cap chỉ chặn LLM call thật — check SAU khi đã loại các case không tốn chi phí (404/422/cache
  // hit) ở trên, để lỗi validate không lãng phí quota của user.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const usedToday = await prisma.aiUsageLog.count({
    where: { userId, feature: "player_compare", createdAt: { gte: since } },
  });
  if (usedToday >= DAILY_CAP) {
    return { status: 429, body: { error: "player_compare_limit_exceeded", limitPerDay: DAILY_CAP } };
  }

  const { system, prompt } = buildComparePrompt(a, b);
  const result = await llmProvider.generateText({ system, prompt });

  const saved = await prisma.aiPlayerComparison.upsert({
    where: { playerAId_playerBId: { playerAId: loId, playerBId: hiId } },
    create: { playerAId: loId, playerBId: hiId, content: result.content, model: result.model },
    update: { content: result.content, model: result.model },
  });

  await prisma.aiUsageLog.create({
    data: {
      userId,
      feature: "player_compare",
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      costUsd: estimateCostUsd(result.model, result.tokensInput, result.tokensOutput),
    },
  });
  await recordHistoryView(userId, saved.id);

  return {
    status: 200,
    body: {
      playerA: toSide(a),
      playerB: toSide(b),
      comparison: { content: saved.content, model: saved.model, createdAt: saved.createdAt },
      cached: false,
    },
  };
}

const playerSelect = { id: true, name: true, team: { select: { id: true, name: true, logoUrl: true } } } as const;

// Giới hạn 50 — trang /compare/history chỉ cần "gần đây", không phải audit log đầy đủ; user thật
// khó tạo quá 50 cặp khác nhau đủ để cần phân trang (cap 20 lượt LLM/ngày, xem DAILY_CAP).
const HISTORY_LIMIT = 50;

export const playerCompareRoute = new Hono()
  .post("/players/compare", requireAuth, zValidator("json", compareBodySchema), async (c) => {
    const { playerAId, playerBId } = c.req.valid("json");
    const userId = c.get("userId");
    const result = await compareTwoPlayers(playerAId, playerBId, userId);
    return c.json(result.body, result.status);
  })
  .get("/players/compare/history", requireAuth, async (c) => {
    const userId = c.get("userId");
    const history = await prisma.playerCompareHistory.findMany({
      where: { userId },
      orderBy: { viewedAt: "desc" },
      take: HISTORY_LIMIT,
      include: {
        comparison: { include: { playerA: { select: playerSelect }, playerB: { select: playerSelect } } },
      },
    });
    return c.json({
      items: history.map((h) => ({
        id: h.id,
        viewedAt: h.viewedAt,
        playerA: h.comparison.playerA,
        playerB: h.comparison.playerB,
        comparison: {
          content: h.comparison.content,
          model: h.comparison.model,
          createdAt: h.comparison.createdAt,
        },
      })),
    });
  });
