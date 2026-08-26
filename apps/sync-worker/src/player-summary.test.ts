import type { LlmProvider } from "@football-app/ai-provider";
import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePlayerSummaryIfNeeded } from "./player-summary";

// Test chạy against Postgres thật (Docker), cùng pattern với match-summary.test.ts.

const PROVIDER = "player-summary-test-provider";
const ref = (id: string) => ({ provider: PROVIDER, id });

function makeFakeLlmProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    providerName: "fake",
    generateText: vi.fn().mockResolvedValue({
      content: "Cầu thủ X có mùa giải ấn tượng.",
      model: "fake-model",
      tokensInput: 100,
      tokensOutput: 20,
    }),
    ...overrides,
  };
}

async function seedPlayerWithStats(overrides: { appearances?: number } = {}) {
  const competition = await prisma.competition.create({
    data: { name: "Player Summary Test League", type: "LEAGUE", externalRef: ref("comp-1") as object },
  });
  const season = await prisma.season.create({
    data: {
      competitionId: competition.id,
      name: "2025",
      startDate: new Date("2025-08-01"),
      endDate: new Date("2026-05-01"),
      isCurrent: true,
    },
  });
  const team = await prisma.team.create({
    data: { name: "Player Summary Test Team", externalRef: ref("team-1") as object },
  });
  const player = await prisma.player.create({
    data: { name: "Cầu Thủ Test", position: "Forward", teamId: team.id, externalRef: ref("player-1") as object },
  });
  await prisma.playerStatistics.create({
    data: {
      playerId: player.id,
      seasonId: season.id,
      appearances: overrides.appearances ?? 20,
      goals: 10,
      assists: 5,
      yellowCards: 2,
      redCards: 0,
    },
  });
  return player;
}

async function cleanupTestData() {
  await prisma.aiPlayerSummary.deleteMany({ where: { player: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.playerStatistics.deleteMany({ where: { player: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.player.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.season.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.competition.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
}

beforeEach(cleanupTestData);
afterAll(cleanupTestData);

describe("generatePlayerSummaryIfNeeded", () => {
  it("gọi LLM và lưu AiPlayerSummary cho cầu thủ có PlayerStatistics chưa có summary", async () => {
    const player = await seedPlayerWithStats();
    const llmProvider = makeFakeLlmProvider();

    await generatePlayerSummaryIfNeeded(player.id, llmProvider);

    expect(llmProvider.generateText).toHaveBeenCalledTimes(1);
    const saved = await prisma.aiPlayerSummary.findUnique({ where: { playerId: player.id } });
    expect(saved?.content).toBe("Cầu thủ X có mùa giải ấn tượng.");
    expect(saved?.model).toBe("fake-model");
  });

  it("bỏ qua cầu thủ chưa có PlayerStatistics (appearances=0), không gọi LLM", async () => {
    const player = await seedPlayerWithStats({ appearances: 0 });
    const llmProvider = makeFakeLlmProvider();

    await generatePlayerSummaryIfNeeded(player.id, llmProvider);

    expect(llmProvider.generateText).not.toHaveBeenCalled();
    const saved = await prisma.aiPlayerSummary.findUnique({ where: { playerId: player.id } });
    expect(saved).toBeNull();
  });

  it("TTL — không gọi LLM lại nếu summary còn mới (< 7 ngày)", async () => {
    const player = await seedPlayerWithStats();
    await prisma.aiPlayerSummary.create({
      data: { playerId: player.id, content: "Đã có sẵn, còn mới.", model: "fake-model" },
    });
    const llmProvider = makeFakeLlmProvider();

    await generatePlayerSummaryIfNeeded(player.id, llmProvider);

    expect(llmProvider.generateText).not.toHaveBeenCalled();
  });

  it("TTL hết hạn (> 7 ngày) — gọi LLM lại và upsert đè summary cũ", async () => {
    const player = await seedPlayerWithStats();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await prisma.aiPlayerSummary.create({
      data: { playerId: player.id, content: "Đã cũ.", model: "fake-model", createdAt: eightDaysAgo },
    });
    const llmProvider = makeFakeLlmProvider();

    await generatePlayerSummaryIfNeeded(player.id, llmProvider);

    expect(llmProvider.generateText).toHaveBeenCalledTimes(1);
    const saved = await prisma.aiPlayerSummary.findUnique({ where: { playerId: player.id } });
    expect(saved?.content).toBe("Cầu thủ X có mùa giải ấn tượng.");
  });

  it("lỗi từ LLM provider throw ra ngoài (caller tự try/catch, không nuốt lỗi ở đây)", async () => {
    const player = await seedPlayerWithStats();
    const llmProvider = makeFakeLlmProvider({
      generateText: vi.fn().mockRejectedValue(new Error("Gemini request failed: 500")),
    });

    await expect(generatePlayerSummaryIfNeeded(player.id, llmProvider)).rejects.toThrow(/500/);
    const saved = await prisma.aiPlayerSummary.findUnique({ where: { playerId: player.id } });
    expect(saved).toBeNull();
  });
});
