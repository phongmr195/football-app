import type { EmbeddingProvider } from "@football-app/ai-provider";
import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildChatContext } from "./chat-retrieval";

// Inject fake EmbeddingProvider trực tiếp (tham số thứ 2 của buildChatContext) — mirror pattern
// compareTwoPlayers/generatePlayerSummaryIfNeeded's llmProvider param, KHÔNG module-mock vì đây là
// test cho chính hàm này, không phải test ở tầng route.
const PROVIDER = "chat-retrieval-test-provider";
const EMBEDDING_SOURCE_TYPE = "chat-retrieval-test";
const ref = (id: string) => ({ provider: PROVIDER, id });
const VECTOR_DIM = 768;

// Vector đơn vị (1 phần tử = 1, còn lại = 0) — dựng cosine similarity chính xác, không cần gọi
// embedding thật: 2 vector CÙNG index -> similarity 1.0 (qua ngưỡng), 2 vector KHÁC index (trực
// giao) -> similarity 0 (dưới ngưỡng VECTOR_FALLBACK_SIMILARITY_THRESHOLD = 0.65).
function unitVector(index: number): number[] {
  const v = new Array(VECTOR_DIM).fill(0);
  v[index] = 1;
  return v;
}

function makeFakeEmbeddingProvider(queryVector: number[] = unitVector(0)): EmbeddingProvider {
  return {
    providerName: "fake",
    embed: vi.fn().mockResolvedValue({ embedding: queryVector, model: "fake-embedding-model" }),
  };
}

async function seedEmbedding(sourceId: string, content: string, vector: number[]) {
  const row = await prisma.embedding.create({
    data: { sourceType: EMBEDDING_SOURCE_TYPE, sourceId, content, model: "fake-embedding-model" },
  });
  await prisma.$executeRaw`UPDATE "embeddings" SET "embedding" = ${JSON.stringify(vector)}::vector WHERE "id" = ${row.id}`;
  return row;
}

async function seedTeamWithStats(name: string) {
  const competition = await prisma.competition.create({
    data: { name: `Chat Retrieval Test League ${name}`, type: "LEAGUE", externalRef: ref(`comp-team-${name}`) as object },
  });
  const season = await prisma.season.create({
    data: { competitionId: competition.id, name: "2025", startDate: new Date("2025-08-01"), endDate: new Date("2026-05-01") },
  });
  const team = await prisma.team.create({ data: { name, externalRef: ref(`team-${name}`) as object } });
  await prisma.teamStatistics.create({
    data: { teamId: team.id, seasonId: season.id, wins: 10, draws: 2, losses: 3, goalsFor: 30, goalsAgainst: 10, cleanSheets: 5 },
  });
  return team;
}

async function seedPlayerWithStats(name: string) {
  const competition = await prisma.competition.create({
    data: { name: `Chat Retrieval Test League Player ${name}`, type: "LEAGUE", externalRef: ref(`comp-player-${name}`) as object },
  });
  const season = await prisma.season.create({
    data: { competitionId: competition.id, name: "2025", startDate: new Date("2025-08-01"), endDate: new Date("2026-05-01") },
  });
  const team = await prisma.team.create({ data: { name: `Team of ${name}`, externalRef: ref(`team-of-${name}`) as object } });
  const player = await prisma.player.create({
    data: { name, position: "Forward", teamId: team.id, externalRef: ref(`player-${name}`) as object },
  });
  await prisma.playerStatistics.create({
    data: { playerId: player.id, seasonId: season.id, appearances: 20, goals: 8, assists: 3, yellowCards: 1, redCards: 0 },
  });
  return player;
}

async function seedComparison(playerAId: string, playerBId: string, content: string, createdAt?: Date) {
  return prisma.aiPlayerComparison.create({
    data: { playerAId, playerBId, content, model: "fake-model", ...(createdAt ? { createdAt } : {}) },
  });
}

async function cleanupTestData() {
  await prisma.embedding.deleteMany({ where: { sourceType: EMBEDDING_SOURCE_TYPE } });
  await prisma.aiPlayerComparison.deleteMany({
    where: { OR: [{ playerA: { externalRef: { path: ["provider"], equals: PROVIDER } } }, { playerB: { externalRef: { path: ["provider"], equals: PROVIDER } } }] },
  });
  await prisma.playerStatistics.deleteMany({ where: { player: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.teamStatistics.deleteMany({ where: { team: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.player.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.season.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.competition.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
}

beforeEach(cleanupTestData);
afterAll(cleanupTestData);

describe("buildChatContext", () => {
  it("ILIKE khớp được 1 team -> trả block của team, KHÔNG gọi vectorFallback", async () => {
    const team = await seedTeamWithStats("Chat Retrieval FC Alpha");
    const embeddingProvider = makeFakeEmbeddingProvider();

    const context = await buildChatContext(`Cho tôi biết về ${team.name}`, embeddingProvider);

    expect(context).toContain(team.name);
    expect(embeddingProvider.embed).not.toHaveBeenCalled();
  });

  it("ILIKE khớp 2 cầu thủ có comparison còn fresh -> block gồm cả 2 mô tả cầu thủ VÀ comparison", async () => {
    const playerA = await seedPlayerWithStats("Chat Retrieval Player Beta");
    const playerB = await seedPlayerWithStats("Chat Retrieval Player Gamma");
    await seedComparison(playerA.id, playerB.id, "Beta nhích hơn về bàn thắng, Gamma kiến tạo tốt hơn.");
    const embeddingProvider = makeFakeEmbeddingProvider();

    const context = await buildChatContext(`So sánh ${playerA.name} và ${playerB.name}`, embeddingProvider);

    expect(context).toContain(playerA.name);
    expect(context).toContain(playerB.name);
    expect(context).toContain("Beta nhích hơn về bàn thắng, Gamma kiến tạo tốt hơn.");
    expect(embeddingProvider.embed).not.toHaveBeenCalled();
  });

  it("ILIKE khớp 1 cầu thủ có comparison với người KHÔNG được nhắc tên -> comparison vẫn được đưa vào", async () => {
    const playerA = await seedPlayerWithStats("Chat Retrieval Player Delta");
    const playerB = await seedPlayerWithStats("Chat Retrieval Player Epsilon");
    await seedComparison(playerA.id, playerB.id, "Delta và Epsilon đều ổn định.");
    const embeddingProvider = makeFakeEmbeddingProvider();

    // Chỉ nhắc tên Delta trong message, KHÔNG nhắc Epsilon.
    const context = await buildChatContext(`${playerA.name} dạo này đá thế nào?`, embeddingProvider);

    expect(context).toContain("Delta và Epsilon đều ổn định.");
  });

  it("comparison đã hết TTL (>7 ngày) -> bị loại khỏi context", async () => {
    const playerA = await seedPlayerWithStats("Chat Retrieval Player Zeta");
    const playerB = await seedPlayerWithStats("Chat Retrieval Player Eta");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await seedComparison(playerA.id, playerB.id, "So sánh đã cũ, không nên xuất hiện.", eightDaysAgo);
    const embeddingProvider = makeFakeEmbeddingProvider();

    const context = await buildChatContext(`So sánh ${playerA.name} và ${playerB.name}`, embeddingProvider);

    expect(context).not.toContain("So sánh đã cũ, không nên xuất hiện.");
  });

  it("ILIKE không khớp gì -> vectorFallback chạy, trả content có similarity qua ngưỡng", async () => {
    const queryVector = unitVector(0);
    await seedEmbedding("fallback-match", "Nội dung liên quan thật.", unitVector(0)); // similarity 1.0
    const embeddingProvider = makeFakeEmbeddingProvider(queryVector);

    const context = await buildChatContext("Câu hỏi không nhắc tên ai trong DB cả", embeddingProvider);

    expect(context).toContain("Nội dung liên quan thật.");
    expect(embeddingProvider.embed).toHaveBeenCalledTimes(1);
  });

  it("vectorFallback bỏ qua kết quả dưới ngưỡng similarity", async () => {
    const queryVector = unitVector(0);
    await seedEmbedding("fallback-orthogonal", "Nội dung KHÔNG liên quan.", unitVector(1)); // similarity 0
    const embeddingProvider = makeFakeEmbeddingProvider(queryVector);

    const context = await buildChatContext("Câu hỏi không nhắc tên ai trong DB cả", embeddingProvider);

    expect(context).toBe("");
  });
});
