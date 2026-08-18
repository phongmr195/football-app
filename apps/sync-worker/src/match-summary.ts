import { prisma } from "@football-app/database";
import type { LlmProvider } from "@football-app/ai-provider";
import { createLlmProvider } from "./ai-provider";

// Giá cứng theo model, USD/1 triệu token — chỉ cần đúng cho model mặc định lúc này
// (claude-haiku-4-5-20251001, $1 input / $5 output, xác nhận 8/2026). Cập nhật nếu đổi
// ANTHROPIC_MODEL sang model khác. Chỉ dùng để log quan sát chi phí (console), KHÔNG ghi AiUsageLog
// — xem lý do ở plan (job hệ thống, không có user để gán quota).
const PRICE_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

function estimateCostUsd(model: string, tokensInput: number, tokensOutput: number): number | null {
  const price = PRICE_PER_MILLION_TOKENS_USD[model];
  if (!price) return null;
  return (tokensInput * price.input + tokensOutput * price.output) / 1_000_000;
}

function buildPrompt(params: {
  competitionName: string;
  seasonName: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  homeStanding: { position: number; points: number } | null;
  awayStanding: { position: number; points: number } | null;
}): { system: string; prompt: string } {
  const standingLine = (name: string, standing: { position: number; points: number } | null) =>
    standing ? `${name} đang xếp hạng ${standing.position} với ${standing.points} điểm.` : "";

  const prompt = [
    `Trận đấu: ${params.homeTeamName} ${params.homeScore} - ${params.awayScore} ${params.awayTeamName}`,
    `Giải đấu: ${params.competitionName}, mùa giải ${params.seasonName}.`,
    standingLine(params.homeTeamName, params.homeStanding),
    standingLine(params.awayTeamName, params.awayStanding),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    system:
      "Bạn là biên tập viên thể thao. Viết tóm tắt kết quả trận đấu bóng đá bằng tiếng Việt, " +
      "ngắn gọn (2-3 câu), tự nhiên. Chỉ dựa trên thông tin được cung cấp — KHÔNG bịa thêm diễn " +
      "biến trận đấu (không có dữ liệu chi tiết theo phút cho trận này).",
    prompt,
  };
}

// Idempotent — guard bằng AiMatchSummary.matchId (@unique trong schema.prisma) NGAY từ đầu, trước
// khi gọi LLM, để không tốn tiền gọi lại cho match đã có summary. Gọi ở 2 nơi độc lập
// (sync-live-matches.ts VÀ sync-catalog.ts's syncMatches — xem plan) nên phải tự an toàn khi bị
// gọi trùng, không dựa vào caller tự đảm bảo "chỉ gọi 1 lần".
export async function generateMatchSummaryIfNeeded(
  matchId: string,
  llmProvider: LlmProvider = createLlmProvider(),
): Promise<void> {
  const existing = await prisma.aiMatchSummary.findUnique({ where: { matchId } });
  if (existing) return;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true, competition: true, season: true },
  });
  if (!match || match.status !== "FINISHED" || match.homeScore == null || match.awayScore == null) {
    return;
  }

  const [homeStanding, awayStanding] = await Promise.all([
    prisma.standing.findUnique({
      where: { seasonId_teamId: { seasonId: match.seasonId, teamId: match.homeTeamId } },
      select: { position: true, points: true },
    }),
    prisma.standing.findUnique({
      where: { seasonId_teamId: { seasonId: match.seasonId, teamId: match.awayTeamId } },
      select: { position: true, points: true },
    }),
  ]);

  const { system, prompt } = buildPrompt({
    competitionName: match.competition.name,
    seasonName: match.season.name,
    homeTeamName: match.homeTeam.name,
    awayTeamName: match.awayTeam.name,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeStanding,
    awayStanding,
  });

  const result = await llmProvider.generateText({ system, prompt });

  await prisma.aiMatchSummary.create({
    data: { matchId: match.id, content: result.content, model: result.model },
  });

  const costUsd = estimateCostUsd(result.model, result.tokensInput, result.tokensOutput);
  console.log(
    `generateMatchSummaryIfNeeded: match ${matchId} — model=${result.model} ` +
      `tokensInput=${result.tokensInput} tokensOutput=${result.tokensOutput} ` +
      `costUsd=${costUsd ?? "unknown"}`,
  );
}
