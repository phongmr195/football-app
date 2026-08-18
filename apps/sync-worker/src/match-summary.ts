import { prisma } from "@football-app/database";
import type { LlmProvider } from "@football-app/ai-provider";
import { createLlmProvider } from "./ai-provider";

// Giá cứng theo model, USD/1 triệu token — chỉ cần đúng cho model đang thật sự dùng. Cập nhật nếu
// đổi ANTHROPIC_MODEL/GEMINI_MODEL sang model khác. Chỉ dùng để log quan sát chi phí (console),
// KHÔNG ghi AiUsageLog — xem lý do ở plan (job hệ thống, không có user để gán quota).
const PRICE_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  // Free tier (Google AI Studio) — $0 trong hạn mức free, xem CLAUDE.md § AI.
  "gemini-3.5-flash-lite": { input: 0, output: 0 },
};

// Nhãn tiếng Việt cho MatchEventType — mirror rút gọn của apps/web/src/lib/format.ts's
// matchEventTypeLabel (không import chung được, khác app/package) — chỉ cần đủ cho prompt, không
// cần đẹp như UI.
const EVENT_TYPE_LABELS: Record<string, string> = {
  GOAL: "Bàn thắng",
  OWN_GOAL: "Phản lưới nhà",
  PENALTY: "Phạt đền",
  YELLOW_CARD: "Thẻ vàng",
  RED_CARD: "Thẻ đỏ",
  SUBSTITUTION: "Thay người",
  VAR: "VAR",
};

interface EventForPrompt {
  minute: number;
  type: string;
  player: { name: string } | null;
  relatedPlayer: { name: string } | null;
}

function formatEventLine(event: EventForPrompt): string {
  const label = EVENT_TYPE_LABELS[event.type] ?? event.type;
  if (event.type === "SUBSTITUTION" && event.relatedPlayer && event.player) {
    return `${event.minute}' ${label}: ${event.relatedPlayer.name} ra, ${event.player.name} vào sân`;
  }
  if (event.player) {
    const assist = event.relatedPlayer ? ` (kiến tạo: ${event.relatedPlayer.name})` : "";
    return `${event.minute}' ${label}: ${event.player.name}${assist}`;
  }
  return `${event.minute}' ${label}`;
}

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
  events: EventForPrompt[];
}): { system: string; prompt: string } {
  const standingLine = (name: string, standing: { position: number; points: number } | null) =>
    standing ? `${name} đang xếp hạng ${standing.position} với ${standing.points} điểm.` : "";

  const hasEvents = params.events.length > 0;

  const prompt = [
    `Trận đấu: ${params.homeTeamName} ${params.homeScore} - ${params.awayScore} ${params.awayTeamName}`,
    `Giải đấu: ${params.competitionName}, mùa giải ${params.seasonName}.`,
    standingLine(params.homeTeamName, params.homeStanding),
    standingLine(params.awayTeamName, params.awayStanding),
    // Chỉ trận đã scrape qua apps/scraper-sofascore mới có (verify thật 2026-08-18 — chỉ áp dụng
    // cho trận tóm tắt TỪ GIỜ TRỞ ĐI, không regenerate summary cũ đã sinh trước khi có event data,
    // theo đúng quyết định giữ nguyên summary cũ). Không giới hạn số event đưa vào prompt — để
    // model tự chọn 1-2 khoảnh khắc đáng nhắc tới thay vì liệt kê hết trong câu trả lời.
    hasEvents ? "Diễn biến chính:" : "",
    ...params.events.map(formatEventLine),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    system: hasEvents
      ? "Bạn là biên tập viên thể thao. Viết tóm tắt kết quả trận đấu bóng đá bằng tiếng Việt, " +
        "ngắn gọn (4-5 câu), tự nhiên. Chỉ dựa trên thông tin được cung cấp — KHÔNG bịa thêm chi " +
        "tiết ngoài dữ liệu. Có danh sách diễn biến chính (bàn thắng/thẻ/thay người) — nên nhắc " +
        "tới 1-2 khoảnh khắc đáng chú ý nhất (ai ghi bàn, phút nào), không cần liệt kê hết."
      : "Bạn là biên tập viên thể thao. Viết tóm tắt kết quả trận đấu bóng đá bằng tiếng Việt, " +
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

  const [homeStanding, awayStanding, events] = await Promise.all([
    prisma.standing.findUnique({
      where: { seasonId_teamId: { seasonId: match.seasonId, teamId: match.homeTeamId } },
      select: { position: true, points: true },
    }),
    prisma.standing.findUnique({
      where: { seasonId_teamId: { seasonId: match.seasonId, teamId: match.awayTeamId } },
      select: { position: true, points: true },
    }),
    // Chỉ trận đã scrape qua apps/scraper-sofascore mới có dòng nào — rỗng cho phần lớn match
    // (giải/mùa khác), buildPrompt tự fallback về tóm tắt đơn giản khi rỗng.
    prisma.matchEvent.findMany({
      where: { matchId },
      orderBy: { seq: "asc" },
      select: {
        minute: true,
        type: true,
        player: { select: { name: true } },
        relatedPlayer: { select: { name: true } },
      },
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
    events,
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
