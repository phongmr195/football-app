import { prisma } from "@football-app/database";
import type { LlmProvider } from "@football-app/ai-provider";
import { createLlmProvider } from "./ai-provider";

// Giá cứng theo model — copy riêng từ player-summary.ts/match-summary.ts (không export dùng
// chung) để các module độc lập, tránh coupling chỉ vì 1 bảng giá nhỏ.
const PRICE_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "gemini-3.5-flash-lite": { input: 0, output: 0 },
};

function estimateCostUsd(model: string, tokensInput: number, tokensOutput: number): number | null {
  const price = PRICE_PER_MILLION_TOKENS_USD[model];
  if (!price) return null;
  return (tokensInput * price.input + tokensOutput * price.output) / 1_000_000;
}

// Khác apps/api's compareTwoPlayers() (route /players/compare, cap 20/user/24h qua AiUsageLog,
// user tự chọn cặp) — đây là job hệ thống sinh corpus cho AiPlayerComparison, KHÔNG có user thật
// để gán quota, cùng lý do ai_match_summary/ai_player_summary KHÔNG dùng AiUsageLog (xem CLAUDE.md
// § AI). KHÔNG ghi PlayerCompareHistory (không có user thật đang "xem"). TTL/prompt mirror
// compareTwoPlayers() (apps/api/src/routes/player-compare.ts) nhưng KHÔNG import cross-app —
// apps/sync-worker không phụ thuộc apps/api, tự có bản build prompt riêng (ngắn, không đáng
// coupling 2 app chỉ vì 1 hàm nhỏ).
const COMPARISON_TTL_DAYS = 7;

interface PlayerForComparison {
  id: string;
  name: string;
  position: string | null;
  teamName: string | null;
  competitionName: string;
  seasonName: string;
  appearances: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
}

async function loadPlayerForComparison(playerId: string): Promise<PlayerForComparison | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { team: true } });
  if (!player) return null;

  const stats = await prisma.playerStatistics.findFirst({
    where: { playerId, appearances: { gt: 0 } },
    orderBy: { season: { startDate: "desc" } },
    include: { season: { include: { competition: true } } },
  });
  if (!stats) return null;

  return {
    id: player.id,
    name: player.name,
    position: player.position,
    teamName: player.team?.name ?? null,
    competitionName: stats.season.competition.name,
    seasonName: stats.season.name,
    appearances: stats.appearances,
    goals: stats.goals,
    assists: stats.assists,
    yellowCards: stats.yellowCards,
    redCards: stats.redCards,
  };
}

function buildPrompt(a: PlayerForComparison, b: PlayerForComparison): { system: string; prompt: string } {
  function describe(p: PlayerForComparison, label: string): string {
    const team = p.teamName ? `, đội ${p.teamName}` : "";
    const position = p.position ? ` (${p.position})` : "";
    const line = `${p.appearances} trận, ${p.goals} bàn thắng, ${p.assists} kiến tạo, ` +
      `${p.yellowCards} thẻ vàng, ${p.redCards} thẻ đỏ`;
    return `${label}: ${p.name}${position}${team}. Giải đấu/mùa: ${p.competitionName}, mùa ${p.seasonName}. Thống kê: ${line}.`;
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

// Trả `true` nếu VỪA sinh mới (tốn 1 lần gọi LLM), `false` nếu bỏ qua (thiếu statistics ở 1 trong
// 2 người, hoặc đã có comparison còn trong TTL).
export async function generatePlayerComparisonIfNeeded(
  playerAId: string,
  playerBId: string,
  llmProvider: LlmProvider = createLlmProvider(),
): Promise<boolean> {
  // Canonical order — cùng quy ước compareTwoPlayers() (apps/api), 1 cặp luôn map về đúng 1 row
  // bất kể thứ tự truyền vào.
  const loId = playerAId < playerBId ? playerAId : playerBId;
  const hiId = playerAId < playerBId ? playerBId : playerAId;
  if (loId === hiId) return false;

  const existing = await prisma.aiPlayerComparison.findUnique({
    where: { playerAId_playerBId: { playerAId: loId, playerBId: hiId } },
  });
  if (existing && Date.now() - existing.createdAt.getTime() < COMPARISON_TTL_DAYS * 24 * 60 * 60 * 1000) {
    return false;
  }

  const [a, b] = await Promise.all([loadPlayerForComparison(loId), loadPlayerForComparison(hiId)]);
  if (!a || !b) return false;

  const { system, prompt } = buildPrompt(a, b);
  const result = await llmProvider.generateText({ system, prompt });

  await prisma.aiPlayerComparison.upsert({
    where: { playerAId_playerBId: { playerAId: loId, playerBId: hiId } },
    create: { playerAId: loId, playerBId: hiId, content: result.content, model: result.model },
    update: { content: result.content, model: result.model },
  });

  const costUsd = estimateCostUsd(result.model, result.tokensInput, result.tokensOutput);
  console.log(
    `generatePlayerComparisonIfNeeded: ${loId} vs ${hiId} — model=${result.model} ` +
      `tokensInput=${result.tokensInput} tokensOutput=${result.tokensOutput} costUsd=${costUsd ?? "unknown"}`,
  );
  return true;
}
