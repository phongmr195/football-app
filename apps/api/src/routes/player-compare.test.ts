import type { LlmProvider } from "@football-app/ai-provider";
import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { compareTwoPlayers } from "./player-compare";

// requireAuth gọi getFirebaseAuth().verifyIdToken(token) — mock "firebase-admin/auth" cùng
// pattern devices.test.ts, chỉ dùng cho 2 test HTTP-level (401/400) dưới đây. Các test còn lại
// gọi compareTwoPlayers() trực tiếp với fake LlmProvider, bỏ qua tầng HTTP/auth hoàn toàn (giống
// player-summary.test.ts's generatePlayerSummaryIfNeeded).
const VALID_TOKEN = "valid-test-token";
const FIREBASE_UID = "player-compare-test-firebase-uid";
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (token === VALID_TOKEN) return { uid: FIREBASE_UID, email: "player-compare-test@example.com" };
      throw new Error("invalid token");
    },
  }),
}));

const PROVIDER = "player-compare-test-provider";
const ref = (id: string) => ({ provider: PROVIDER, id });

function makeFakeLlmProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    providerName: "fake",
    generateText: vi.fn().mockResolvedValue({
      content: "Cầu thủ A nhích hơn về bàn thắng, cầu thủ B kiến tạo tốt hơn.",
      model: "fake-model",
      tokensInput: 150,
      tokensOutput: 40,
    }),
    ...overrides,
  };
}

async function seedPlayerWithStats(name: string, overrides: { appearances?: number; noStats?: boolean } = {}) {
  const competition = await prisma.competition.create({
    data: { name: `Player Compare Test League ${name}`, type: "LEAGUE", externalRef: ref(`comp-${name}`) as object },
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
    data: { name: `Player Compare Test Team ${name}`, externalRef: ref(`team-${name}`) as object },
  });
  const player = await prisma.player.create({
    data: { name, position: "Forward", teamId: team.id, externalRef: ref(`player-${name}`) as object },
  });
  if (!overrides.noStats) {
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
  }
  return player;
}

async function seedUser() {
  return prisma.user.create({
    data: { firebaseUid: FIREBASE_UID, email: "player-compare-test@example.com" },
  });
}

async function cleanupTestData() {
  await prisma.aiUsageLog.deleteMany({ where: { user: { firebaseUid: FIREBASE_UID } } });
  await prisma.aiPlayerComparison.deleteMany({
    where: { playerA: { externalRef: { path: ["provider"], equals: PROVIDER } } },
  });
  await prisma.playerStatistics.deleteMany({ where: { player: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.player.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.season.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.competition.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.user.deleteMany({ where: { firebaseUid: FIREBASE_UID } });
}

beforeEach(cleanupTestData);
afterAll(cleanupTestData);

describe("POST /players/compare (HTTP-level)", () => {
  it("401 khi chưa có bearer token", async () => {
    const res = await app.request("/players/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerAId: "a", playerBId: "b" }),
    });
    expect(res.status).toBe(401);
  });

  it("400 khi playerAId === playerBId (zValidator refine)", async () => {
    const res = await app.request("/players/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${VALID_TOKEN}` },
      body: JSON.stringify({ playerAId: "same-id", playerBId: "same-id" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("compareTwoPlayers", () => {
  it("404 khi 1 trong 2 cầu thủ không tồn tại", async () => {
    const user = await seedUser();
    const playerA = await seedPlayerWithStats("A1");
    const llmProvider = makeFakeLlmProvider();

    const result = await compareTwoPlayers(playerA.id, "does-not-exist", user.id, llmProvider);

    expect(result.status).toBe(404);
    expect(llmProvider.generateText).not.toHaveBeenCalled();
  });

  it("422 khi 1 trong 2 cầu thủ thiếu PlayerStatistics — không gọi LLM, không ghi AiUsageLog", async () => {
    const user = await seedUser();
    const playerA = await seedPlayerWithStats("A2");
    const playerB = await seedPlayerWithStats("B2", { noStats: true });
    const llmProvider = makeFakeLlmProvider();

    const result = await compareTwoPlayers(playerA.id, playerB.id, user.id, llmProvider);

    expect(result.status).toBe(422);
    expect(llmProvider.generateText).not.toHaveBeenCalled();
    const usage = await prisma.aiUsageLog.findMany({ where: { userId: user.id } });
    expect(usage).toHaveLength(0);
  });

  it("canonical order — gọi (X,Y) rồi (Y,X) chỉ tạo 1 row, lần 2 là cache hit", async () => {
    const user = await seedUser();
    const playerX = await seedPlayerWithStats("X3");
    const playerY = await seedPlayerWithStats("Y3");
    const llmProvider = makeFakeLlmProvider();

    const first = await compareTwoPlayers(playerX.id, playerY.id, user.id, llmProvider);
    expect(first.status).toBe(200);
    if (first.status === 200) expect(first.body.cached).toBe(false);

    const second = await compareTwoPlayers(playerY.id, playerX.id, user.id, llmProvider);
    expect(second.status).toBe(200);
    if (second.status === 200) expect(second.body.cached).toBe(true);

    expect(llmProvider.generateText).toHaveBeenCalledTimes(1);
    const rows = await prisma.aiPlayerComparison.findMany({
      where: { OR: [{ playerAId: playerX.id }, { playerAId: playerY.id }] },
    });
    expect(rows).toHaveLength(1);
  });

  it("TTL-fresh — cache hit không gọi LLM, không tăng AiUsageLog", async () => {
    const user = await seedUser();
    const playerA = await seedPlayerWithStats("A4");
    const playerB = await seedPlayerWithStats("B4");
    const [loId, hiId] = playerA.id < playerB.id ? [playerA.id, playerB.id] : [playerB.id, playerA.id];
    await prisma.aiPlayerComparison.create({
      data: { playerAId: loId, playerBId: hiId, content: "Đã có sẵn, còn mới.", model: "fake-model" },
    });
    const llmProvider = makeFakeLlmProvider();

    const result = await compareTwoPlayers(playerA.id, playerB.id, user.id, llmProvider);

    expect(result.status).toBe(200);
    if (result.status === 200) expect(result.body.cached).toBe(true);
    expect(llmProvider.generateText).not.toHaveBeenCalled();
    const usage = await prisma.aiUsageLog.findMany({ where: { userId: user.id } });
    expect(usage).toHaveLength(0);
  });

  it("TTL hết hạn (> 7 ngày) — gọi LLM lại, upsert, thêm 1 dòng AiUsageLog", async () => {
    const user = await seedUser();
    const playerA = await seedPlayerWithStats("A5");
    const playerB = await seedPlayerWithStats("B5");
    const [loId, hiId] = playerA.id < playerB.id ? [playerA.id, playerB.id] : [playerB.id, playerA.id];
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await prisma.aiPlayerComparison.create({
      data: { playerAId: loId, playerBId: hiId, content: "Đã cũ.", model: "fake-model", createdAt: eightDaysAgo },
    });
    const llmProvider = makeFakeLlmProvider();

    const result = await compareTwoPlayers(playerA.id, playerB.id, user.id, llmProvider);

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.cached).toBe(false);
      expect(result.body.comparison.content).toBe(
        "Cầu thủ A nhích hơn về bàn thắng, cầu thủ B kiến tạo tốt hơn.",
      );
    }
    expect(llmProvider.generateText).toHaveBeenCalledTimes(1);
    const usage = await prisma.aiUsageLog.findMany({ where: { userId: user.id } });
    expect(usage).toHaveLength(1);
  });

  it("429 khi user đã dùng hết 20 lượt/24h — không gọi LLM, không thêm dòng mới", async () => {
    const user = await seedUser();
    const playerA = await seedPlayerWithStats("A6");
    const playerB = await seedPlayerWithStats("B6");
    await prisma.aiUsageLog.createMany({
      data: Array.from({ length: 20 }, () => ({
        userId: user.id,
        feature: "player_compare",
        tokensInput: 10,
        tokensOutput: 10,
        costUsd: 0,
      })),
    });
    const llmProvider = makeFakeLlmProvider();

    const result = await compareTwoPlayers(playerA.id, playerB.id, user.id, llmProvider);

    expect(result.status).toBe(429);
    expect(llmProvider.generateText).not.toHaveBeenCalled();
    const usage = await prisma.aiUsageLog.count({ where: { userId: user.id } });
    expect(usage).toBe(20);
  });

  it("cap không tính cache hit — 20 lượt dùng hết + so sánh 1 cặp ĐÃ có cache vẫn trả 200", async () => {
    const user = await seedUser();
    const playerA = await seedPlayerWithStats("A7");
    const playerB = await seedPlayerWithStats("B7");
    const [loId, hiId] = playerA.id < playerB.id ? [playerA.id, playerB.id] : [playerB.id, playerA.id];
    await prisma.aiPlayerComparison.create({
      data: { playerAId: loId, playerBId: hiId, content: "Cache sẵn có.", model: "fake-model" },
    });
    await prisma.aiUsageLog.createMany({
      data: Array.from({ length: 20 }, () => ({
        userId: user.id,
        feature: "player_compare",
        tokensInput: 10,
        tokensOutput: 10,
        costUsd: 0,
      })),
    });
    const llmProvider = makeFakeLlmProvider();

    const result = await compareTwoPlayers(playerA.id, playerB.id, user.id, llmProvider);

    expect(result.status).toBe(200);
    if (result.status === 200) expect(result.body.cached).toBe(true);
    expect(llmProvider.generateText).not.toHaveBeenCalled();
  });

  it("happy path — 200, đúng shape, cached=false, 1 dòng AiUsageLog đúng token count", async () => {
    const user = await seedUser();
    const playerA = await seedPlayerWithStats("A8");
    const playerB = await seedPlayerWithStats("B8");
    const llmProvider = makeFakeLlmProvider();

    const result = await compareTwoPlayers(playerA.id, playerB.id, user.id, llmProvider);

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.cached).toBe(false);
    expect(result.body.playerA.statistics?.goals).toBe(10);
    expect(result.body.playerB.statistics?.assists).toBe(5);
    expect(result.body.comparison.model).toBe("fake-model");

    const usage = await prisma.aiUsageLog.findMany({ where: { userId: user.id, feature: "player_compare" } });
    expect(usage).toHaveLength(1);
    expect(usage[0]?.tokensInput).toBe(150);
    expect(usage[0]?.tokensOutput).toBe(40);
  });

  it("ghi PlayerCompareHistory cho user — xem lại cùng cặp (cache hit) chỉ bump viewedAt, không tạo dòng mới", async () => {
    const user = await seedUser();
    const playerA = await seedPlayerWithStats("A9");
    const playerB = await seedPlayerWithStats("B9");
    const llmProvider = makeFakeLlmProvider();

    const first = await compareTwoPlayers(playerA.id, playerB.id, user.id, llmProvider);
    expect(first.status).toBe(200);
    const afterFirst = await prisma.playerCompareHistory.findMany({ where: { userId: user.id } });
    expect(afterFirst).toHaveLength(1);
    const firstViewedAt = afterFirst[0]?.viewedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await compareTwoPlayers(playerA.id, playerB.id, user.id, llmProvider);
    expect(second.status).toBe(200);
    if (second.status === 200) expect(second.body.cached).toBe(true);

    const afterSecond = await prisma.playerCompareHistory.findMany({ where: { userId: user.id } });
    expect(afterSecond).toHaveLength(1); // vẫn 1 dòng, không tạo trùng
    expect(afterSecond[0]?.viewedAt.getTime()).toBeGreaterThan(firstViewedAt!.getTime()); // đã bump
  });
});

describe("GET /players/compare/history", () => {
  it("401 khi chưa có bearer token", async () => {
    const res = await app.request("/players/compare/history");
    expect(res.status).toBe(401);
  });

  it("trả lịch sử của user, mới nhất trước, đúng shape", async () => {
    const user = await seedUser();
    const playerA = await seedPlayerWithStats("A10");
    const playerB = await seedPlayerWithStats("B10");
    const playerC = await seedPlayerWithStats("C10");
    const llmProvider = makeFakeLlmProvider();

    await compareTwoPlayers(playerA.id, playerB.id, user.id, llmProvider);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await compareTwoPlayers(playerA.id, playerC.id, user.id, llmProvider);

    const res = await app.request("/players/compare/history", {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      items: { playerA: { id: string; name: string }; playerB: { id: string; name: string } }[];
    };
    expect(data.items).toHaveLength(2);
    // Mới nhất trước — cặp (A10,C10) so sánh sau cùng nên lên đầu.
    const names = [data.items[0]?.playerA.name, data.items[0]?.playerB.name].sort();
    expect(names).toEqual(["A10", "C10"].sort());
  });
});
