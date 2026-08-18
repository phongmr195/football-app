import type { LlmProvider } from "@football-app/ai-provider";
import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateMatchSummaryIfNeeded } from "./match-summary";

// Test chạy against Postgres thật (Docker), cùng pattern seed/cleanup với sync-live-matches.test.ts
// (xem file đó cho lý do). generateMatchSummaryIfNeeded nhận llmProvider qua tham số (không phải
// module-level factory) nên không cần vi.mock("./ai-provider") — chỉ cần truyền fake trực tiếp.

const PROVIDER = "match-summary-test-provider";
const ref = (id: string) => ({ provider: PROVIDER, id });

function makeFakeLlmProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    providerName: "fake",
    generateText: vi.fn().mockResolvedValue({
      content: "Đội A thắng đội B 2-1.",
      model: "fake-model",
      tokensInput: 100,
      tokensOutput: 20,
    }),
    ...overrides,
  };
}

async function seedFinishedMatch(overrides: { homeScore?: number | null; awayScore?: number | null; status?: string } = {}) {
  const competition = await prisma.competition.create({
    data: { name: "Summary Test League", type: "LEAGUE", externalRef: ref("comp-1") as object },
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
  const homeTeam = await prisma.team.create({
    data: { name: "Summary Team A", externalRef: ref("team-a") as object },
  });
  const awayTeam = await prisma.team.create({
    data: { name: "Summary Team B", externalRef: ref("team-b") as object },
  });
  const match = await prisma.match.create({
    data: {
      competitionId: competition.id,
      seasonId: season.id,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      kickoffAt: new Date("2025-09-01T10:00:00.000Z"),
      status: (overrides.status as "FINISHED") ?? "FINISHED",
      homeScore: overrides.homeScore === undefined ? 2 : overrides.homeScore,
      awayScore: overrides.awayScore === undefined ? 1 : overrides.awayScore,
      externalRef: ref("match-1") as object,
    },
  });
  await prisma.standing.create({
    data: { seasonId: season.id, teamId: homeTeam.id, position: 1, points: 30 },
  });
  return match;
}

async function cleanupTestData() {
  await prisma.aiMatchSummary.deleteMany({ where: { match: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.standing.deleteMany({ where: { season: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } } });
  await prisma.match.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.season.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.competition.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
}

beforeEach(cleanupTestData);
afterAll(cleanupTestData);

describe("generateMatchSummaryIfNeeded", () => {
  it("gọi LLM và lưu AiMatchSummary cho match FINISHED chưa có summary", async () => {
    const match = await seedFinishedMatch();
    const llmProvider = makeFakeLlmProvider();

    await generateMatchSummaryIfNeeded(match.id, llmProvider);

    expect(llmProvider.generateText).toHaveBeenCalledTimes(1);
    const saved = await prisma.aiMatchSummary.findUnique({ where: { matchId: match.id } });
    expect(saved?.content).toBe("Đội A thắng đội B 2-1.");
    expect(saved?.model).toBe("fake-model");
  });

  it("idempotent — không gọi LLM lại nếu AiMatchSummary đã tồn tại", async () => {
    const match = await seedFinishedMatch();
    await prisma.aiMatchSummary.create({
      data: { matchId: match.id, content: "Đã có sẵn.", model: "fake-model" },
    });
    const llmProvider = makeFakeLlmProvider();

    await generateMatchSummaryIfNeeded(match.id, llmProvider);

    expect(llmProvider.generateText).not.toHaveBeenCalled();
  });

  it("bỏ qua match chưa FINISHED, không gọi LLM", async () => {
    const match = await seedFinishedMatch({ status: "SCHEDULED", homeScore: null, awayScore: null });
    const llmProvider = makeFakeLlmProvider();

    await generateMatchSummaryIfNeeded(match.id, llmProvider);

    expect(llmProvider.generateText).not.toHaveBeenCalled();
    const saved = await prisma.aiMatchSummary.findUnique({ where: { matchId: match.id } });
    expect(saved).toBeNull();
  });

  it("lỗi từ LLM provider throw ra ngoài (caller tự try/catch, không nuốt lỗi ở đây)", async () => {
    const match = await seedFinishedMatch();
    const llmProvider = makeFakeLlmProvider({
      generateText: vi.fn().mockRejectedValue(new Error("Anthropic request failed: 500")),
    });

    await expect(generateMatchSummaryIfNeeded(match.id, llmProvider)).rejects.toThrow(/500/);
    const saved = await prisma.aiMatchSummary.findUnique({ where: { matchId: match.id } });
    expect(saved).toBeNull();
  });
});
