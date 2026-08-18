import { prisma } from "@football-app/database";
import type { LlmProvider } from "@football-app/ai-provider";
import { createLlmProvider } from "./ai-provider";

// Giá cứng theo model — copy riêng từ match-summary.ts (không export dùng chung) để 2 module độc
// lập, tránh coupling chỉ vì 1 bảng giá nhỏ. Cập nhật đồng thời nếu đổi model mặc định.
const PRICE_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "gemini-3.5-flash-lite": { input: 0, output: 0 },
};

function estimateCostUsd(model: string, tokensInput: number, tokensOutput: number): number | null {
  const price = PRICE_PER_MILLION_TOKENS_USD[model];
  if (!price) return null;
  return (tokensInput * price.input + tokensOutput * price.output) / 1_000_000;
}

// Khác ai_match_summary: stats cầu thủ thay đổi trong suốt mùa giải (không đông cứng như tỉ số
// trận đã FINISHED) — summary có thể lỗi thời dần, cần refresh định kỳ thay vì sinh 1 lần vĩnh
// viễn. 7 ngày là lựa chọn tuỳ ý, đủ để không gọi lại LLM quá thường xuyên (mỗi lần chạy backfill)
// nhưng vẫn cập nhật theo tuần khi cầu thủ đá thêm trận.
const PLAYER_SUMMARY_TTL_DAYS = 7;

function buildPrompt(params: {
  playerName: string;
  position: string | null;
  teamName: string | null;
  competitionName: string;
  seasonName: string;
  appearances: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
}): { system: string; prompt: string } {
  const prompt = [
    `Cầu thủ: ${params.playerName}${params.position ? ` (${params.position})` : ""}${
      params.teamName ? `, đội ${params.teamName}` : ""
    }`,
    `Giải đấu: ${params.competitionName}, mùa giải ${params.seasonName}.`,
    `Thống kê mùa này: ${params.appearances} trận, ${params.goals} bàn thắng, ${params.assists} kiến tạo, ` +
      `${params.yellowCards} thẻ vàng, ${params.redCards} thẻ đỏ.`,
  ].join("\n");

  return {
    system:
      "Bạn là biên tập viên thể thao. Viết nhận xét ngắn gọn (2-3 câu) bằng tiếng Việt về phong độ " +
      "cầu thủ trong mùa giải hiện tại, dựa trên số liệu được cung cấp. Tự nhiên, không liệt kê số " +
      "liệu như bảng biểu. Chỉ dựa trên thông tin được cung cấp — KHÔNG bịa thêm chi tiết ngoài dữ liệu.",
    prompt,
  };
}

// Khác ai_match_summary (trigger tự nhiên qua match FINISHED): cầu thủ không có lifecycle event
// tương tự — CHỈ gọi qua script backfill thủ công (apps/sync-worker/src/scripts/
// backfill-player-summaries.ts), KHÔNG on-demand lúc user vào trang (gọi LLM đồng bộ trong request
// apps/api sẽ làm trang chờ 1-5s, và apps/api hiện chưa phụ thuộc @football-app/ai-provider).
export async function generatePlayerSummaryIfNeeded(
  playerId: string,
  llmProvider: LlmProvider = createLlmProvider(),
): Promise<void> {
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { team: true } });
  if (!player) return;

  // Mùa gần nhất có data — cùng pattern GET /statistics/players/:id (apps/api/src/routes/
  // statistics.ts) khi không truyền seasonId.
  const stats = await prisma.playerStatistics.findFirst({
    where: { playerId },
    orderBy: { season: { startDate: "desc" } },
    include: { season: { include: { competition: true } } },
  });
  if (!stats || stats.appearances === 0) return;

  const existing = await prisma.aiPlayerSummary.findUnique({ where: { playerId } });
  if (existing) {
    const ageMs = Date.now() - existing.createdAt.getTime();
    if (ageMs < PLAYER_SUMMARY_TTL_DAYS * 24 * 60 * 60 * 1000) return;
  }

  const { system, prompt } = buildPrompt({
    playerName: player.name,
    position: player.position,
    teamName: player.team?.name ?? null,
    competitionName: stats.season.competition.name,
    seasonName: stats.season.name,
    appearances: stats.appearances,
    goals: stats.goals,
    assists: stats.assists,
    yellowCards: stats.yellowCards,
    redCards: stats.redCards,
  });

  const result = await llmProvider.generateText({ system, prompt });

  await prisma.aiPlayerSummary.upsert({
    where: { playerId },
    create: { playerId, content: result.content, model: result.model },
    update: { content: result.content, model: result.model },
  });

  const costUsd = estimateCostUsd(result.model, result.tokensInput, result.tokensOutput);
  console.log(
    `generatePlayerSummaryIfNeeded: player ${playerId} — model=${result.model} ` +
      `tokensInput=${result.tokensInput} tokensOutput=${result.tokensOutput} ` +
      `costUsd=${costUsd ?? "unknown"}`,
  );
}
