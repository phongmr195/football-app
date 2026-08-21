import { prisma } from "@football-app/database";
import type { EmbeddingProvider } from "@football-app/ai-provider";
import { createEmbeddingProvider } from "./embedding-provider";

// "RAG-lite" — quét tên Team/Player xuất hiện trong tin nhắn user bằng raw SQL (đẩy scan xuống
// Postgres, không load hết tên vào memory app), rồi lấy AiMatchSummary/AiPlayerSummary + số liệu
// mùa gần nhất liên quan để đưa vào prompt. ILIKE vẫn là nguồn CHÍNH (chính xác, rẻ) — pgvector
// (2026-08-21, xem docs/architecture/PROJECT_PLAN.md) chỉ bổ sung 2 chỗ: (1) tra thẳng
// AiPlayerComparison theo id cầu thủ ILIKE đã resolve (quan hệ, KHÔNG cần vector — chính xác hơn
// vector cho đúng nhu cầu này), (2) vectorFallback() làm phương án CUỐI khi ILIKE không khớp được
// gì cả. So sánh thật (apps/api/src/scripts/compare-retrieval.ts) cho thấy vector-only sẽ trả noise
// cho câu hỏi ngoài corpus (không có ngưỡng), nên KHÔNG dùng vector làm nguồn chính.
//
// Hạn chế đã biết, chấp nhận cho v1: ILIKE không fold dấu (cần unaccent extension, không thêm ở
// piece này); chỉ resolve từng Team/Player riêng lẻ, không resolve "đội A vs đội B" trong 1 câu.
const MIN_ENTITY_NAME_LENGTH = 4;
const MAX_ENTITIES_PER_TYPE = 3;
// Cùng TTL với apps/api/src/routes/player-compare.ts's COMPARE_TTL_DAYS — stats 2 cầu thủ đổi
// trong mùa, không coi comparison cũ là evergreen.
const COMPARISON_TTL_DAYS = 7;
// Ngưỡng cosine similarity cho vectorFallback() — chọn từ số liệu thật đo được (Phase 1 so sánh):
// match thật ghi 0.6-0.88, case xác nhận KHÔNG liên quan (hỏi cầu thủ không có trong DB) cao nhất
// chỉ 0.585. Heuristic từ mẫu nhỏ, có thể cần tinh chỉnh khi có thêm dữ liệu thật.
const VECTOR_FALLBACK_SIMILARITY_THRESHOLD = 0.65;
const VECTOR_FALLBACK_LIMIT = 5;

interface MatchedTeam {
  id: string;
  name: string;
}

interface MatchedPlayer {
  id: string;
  name: string;
}

async function findMentionedTeams(message: string): Promise<MatchedTeam[]> {
  return prisma.$queryRaw<MatchedTeam[]>`
    SELECT id, name FROM teams
    WHERE ${message} ILIKE '%' || name || '%' AND length(name) >= ${MIN_ENTITY_NAME_LENGTH}
    LIMIT ${MAX_ENTITIES_PER_TYPE}
  `;
}

async function findMentionedPlayers(message: string): Promise<MatchedPlayer[]> {
  return prisma.$queryRaw<MatchedPlayer[]>`
    SELECT id, name FROM players
    WHERE ${message} ILIKE '%' || name || '%' AND length(name) >= ${MIN_ENTITY_NAME_LENGTH}
    LIMIT ${MAX_ENTITIES_PER_TYPE}
  `;
}

async function describeTeam(team: MatchedTeam): Promise<string> {
  const [stats, summary] = await Promise.all([
    prisma.teamStatistics.findFirst({
      where: { teamId: team.id },
      orderBy: { season: { startDate: "desc" } },
      include: { season: { include: { competition: true } } },
    }),
    prisma.match.findFirst({
      where: { OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }], status: "FINISHED", aiSummary: { isNot: null } },
      orderBy: { kickoffAt: "desc" },
      include: { aiSummary: true },
    }),
  ]);

  const lines = [`Đội ${team.name}:`];
  if (stats) {
    lines.push(
      `- Mùa ${stats.season.name} (${stats.season.competition.name}): ${stats.wins} thắng, ${stats.draws} hoà, ` +
        `${stats.losses} thua, ghi ${stats.goalsFor} bàn, thủng lưới ${stats.goalsAgainst}, ${stats.cleanSheets} trận giữ sạch lưới.`,
    );
  }
  if (summary?.aiSummary) {
    lines.push(`- Tóm tắt trận gần nhất: ${summary.aiSummary.content}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

async function describePlayer(player: MatchedPlayer): Promise<string> {
  const [stats, summary] = await Promise.all([
    prisma.playerStatistics.findFirst({
      where: { playerId: player.id },
      orderBy: { season: { startDate: "desc" } },
      include: { season: { include: { competition: true } } },
    }),
    prisma.aiPlayerSummary.findUnique({ where: { playerId: player.id } }),
  ]);

  const lines = [`Cầu thủ ${player.name}:`];
  if (stats) {
    lines.push(
      `- Mùa ${stats.season.name} (${stats.season.competition.name}): ${stats.appearances} trận, ` +
        `${stats.goals} bàn, ${stats.assists} kiến tạo, ${stats.yellowCards} thẻ vàng, ${stats.redCards} thẻ đỏ.`,
    );
  }
  if (summary) {
    lines.push(`- Tóm tắt AI: ${summary.content}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

// Tra THẲNG theo id cầu thủ ILIKE đã resolve (quan hệ, KHÔNG qua vector) — chính xác hơn vector cho
// đúng nhu cầu "cầu thủ X có so sánh nào không", vì đã biết chính xác id, không cần suy luận ngữ
// nghĩa. Dùng OR nên KHÔNG yêu cầu CẢ HAI cầu thủ trong 1 comparison đều được nhắc tên trong message
// — 1 cầu thủ được nhắc + có comparison với người khác (chưa nhắc tên) vẫn được đưa vào.
async function findRelevantComparisons(players: MatchedPlayer[]): Promise<string[]> {
  if (players.length === 0) return [];
  const playerIds = players.map((p) => p.id);

  const comparisons = await prisma.aiPlayerComparison.findMany({
    where: {
      OR: [{ playerAId: { in: playerIds } }, { playerBId: { in: playerIds } }],
      createdAt: { gte: new Date(Date.now() - COMPARISON_TTL_DAYS * 24 * 60 * 60 * 1000) },
    },
    include: { playerA: { select: { name: true } }, playerB: { select: { name: true } } },
    take: MAX_ENTITIES_PER_TYPE,
  });

  return comparisons.map((c) => `So sánh ${c.playerA.name} và ${c.playerB.name}: ${c.content}`);
}

// Phương án CUỐI — chỉ gọi khi ILIKE (teams/players/comparisons) không khớp được gì cả. Ngưỡng
// similarity chặn kết quả low-relevance lọt vào prompt (xem VECTOR_FALLBACK_SIMILARITY_THRESHOLD).
async function vectorFallback(message: string, embeddingProvider: EmbeddingProvider): Promise<string[]> {
  const { embedding } = await embeddingProvider.embed(message);
  const vectorLiteral = JSON.stringify(embedding);

  const results = await prisma.$queryRaw<{ content: string; similarity: number }[]>`
    SELECT "content", 1 - ("embedding" <=> ${vectorLiteral}::vector) AS similarity
    FROM "embeddings"
    WHERE "embedding" IS NOT NULL
    ORDER BY "embedding" <=> ${vectorLiteral}::vector
    LIMIT ${VECTOR_FALLBACK_LIMIT}
  `;

  return results.filter((r) => r.similarity >= VECTOR_FALLBACK_SIMILARITY_THRESHOLD).map((r) => r.content);
}

// Trả "" nếu không khớp được gì — prompt vẫn chạy bình thường (system prompt tự dặn AI nói không
// có thông tin thay vì bịa khi thiếu context). `embeddingProvider` injectable để test (mirror
// pattern compareTwoPlayers/generatePlayerSummaryIfNeeded's llmProvider param).
export async function buildChatContext(
  message: string,
  embeddingProvider: EmbeddingProvider = createEmbeddingProvider(),
): Promise<string> {
  const [teams, players] = await Promise.all([findMentionedTeams(message), findMentionedPlayers(message)]);

  const [teamBlocks, playerBlocks, comparisonBlocks] = await Promise.all([
    Promise.all(teams.map(describeTeam)),
    Promise.all(players.map(describePlayer)),
    findRelevantComparisons(players),
  ]);

  let blocks = [...teamBlocks, ...playerBlocks, ...comparisonBlocks].filter(Boolean);
  if (blocks.length === 0) {
    blocks = await vectorFallback(message, embeddingProvider);
  }

  return blocks.join("\n\n");
}
