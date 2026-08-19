import { prisma } from "@football-app/database";

// "RAG-lite" — quét tên Team/Player xuất hiện trong tin nhắn user bằng raw SQL (đẩy scan xuống
// Postgres, không load hết tên vào memory app), rồi lấy AiMatchSummary/AiPlayerSummary + số liệu
// mùa gần nhất liên quan để đưa vào prompt. KHÔNG dùng embedding/pgvector — corpus text thật hiện
// quá nhỏ (~7 dòng prose) để vector search có giá trị hơn substring match, xem plan piece này.
//
// Hạn chế đã biết, chấp nhận cho v1: ILIKE không fold dấu (cần unaccent extension, không thêm ở
// piece này); chỉ resolve từng Team/Player riêng lẻ, không resolve "đội A vs đội B" trong 1 câu.
const MIN_ENTITY_NAME_LENGTH = 4;
const MAX_ENTITIES_PER_TYPE = 3;

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

// Trả "" nếu không khớp được gì — prompt vẫn chạy bình thường (system prompt tự dặn AI nói không
// có thông tin thay vì bịa khi thiếu context).
export async function buildChatContext(message: string): Promise<string> {
  const [teams, players] = await Promise.all([findMentionedTeams(message), findMentionedPlayers(message)]);

  const blocks = await Promise.all([...teams.map(describeTeam), ...players.map(describePlayer)]);
  return blocks.filter(Boolean).join("\n\n");
}
