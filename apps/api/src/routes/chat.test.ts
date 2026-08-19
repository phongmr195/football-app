import type { LlmProvider } from "@football-app/ai-provider";
import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { sendChatMessage } from "./chat";

// requireAuth gọi getFirebaseAuth().verifyIdToken(token) — mock "firebase-admin/auth" cùng pattern
// devices.test.ts/player-compare.test.ts. 2 token khác nhau (khác player-compare.test.ts chỉ cần
// 1) — cần test "session của user khác không lẫn vào nhau", nên phải mock được 2 user thật.
const TOKEN_A = "chat-test-token-a";
const TOKEN_B = "chat-test-token-b";
const FIREBASE_UID_A = "chat-test-firebase-uid-a";
const FIREBASE_UID_B = "chat-test-firebase-uid-b";
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (token === TOKEN_A) return { uid: FIREBASE_UID_A, email: "chat-test-a@example.com" };
      if (token === TOKEN_B) return { uid: FIREBASE_UID_B, email: "chat-test-b@example.com" };
      throw new Error("invalid token");
    },
  }),
}));

// sendChatMessage spawn LLM thật qua createLlmProvider() mặc định — mock hẳn module này cho test
// HTTP-level (POST) không truyền llmProvider tường minh, giống pattern sync-worker mock "./ai-provider".
vi.mock("../ai-provider", () => ({
  createLlmProvider: () => ({
    providerName: "fake",
    generateText: vi.fn().mockResolvedValue({
      content: "Đây là câu trả lời giả cho test.",
      model: "fake-model",
      tokensInput: 100,
      tokensOutput: 20,
    }),
  }),
}));

const PROVIDER = "chat-test-provider";
const ref = (id: string) => ({ provider: PROVIDER, id });

function makeFakeLlmProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    providerName: "fake",
    generateText: vi.fn().mockResolvedValue({
      content: "Đây là câu trả lời giả cho test.",
      model: "fake-model",
      tokensInput: 100,
      tokensOutput: 20,
    }),
    ...overrides,
  };
}

async function seedUser(firebaseUid: string, email: string) {
  return prisma.user.create({ data: { firebaseUid, email } });
}

async function seedTeamWithSummary(name: string) {
  const competition = await prisma.competition.create({
    data: { name: `Chat Test League ${name}`, type: "LEAGUE", externalRef: ref(`comp-${name}`) as object },
  });
  const season = await prisma.season.create({
    data: { competitionId: competition.id, name: "2025", startDate: new Date("2025-08-01"), endDate: new Date("2026-05-01") },
  });
  const homeTeam = await prisma.team.create({
    data: { name, externalRef: ref(`team-${name}`) as object },
  });
  const awayTeam = await prisma.team.create({
    data: { name: `Chat Test Opponent ${name}`, externalRef: ref(`opponent-${name}`) as object },
  });
  const match = await prisma.match.create({
    data: {
      competitionId: competition.id,
      seasonId: season.id,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      kickoffAt: new Date("2025-09-01T15:00:00Z"),
      status: "FINISHED",
      homeScore: 3,
      awayScore: 1,
    },
  });
  const summaryContent = `${name} thắng đậm 3-1 nhờ phong độ chói sáng trên sân nhà.`;
  await prisma.aiMatchSummary.create({ data: { matchId: match.id, content: summaryContent, model: "fake-model" } });
  return { team: homeTeam, summaryContent };
}

async function cleanupTestData() {
  await prisma.chatHistory.deleteMany({ where: { user: { firebaseUid: { in: [FIREBASE_UID_A, FIREBASE_UID_B] } } } });
  await prisma.aiUsageLog.deleteMany({ where: { user: { firebaseUid: { in: [FIREBASE_UID_A, FIREBASE_UID_B] } } } });
  await prisma.match.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.season.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.competition.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.user.deleteMany({ where: { firebaseUid: { in: [FIREBASE_UID_A, FIREBASE_UID_B] } } });
}

beforeEach(cleanupTestData);
beforeEach(() => {
  vi.clearAllMocks();
});
afterAll(cleanupTestData);

describe("sendChatMessage", () => {
  it("429 khi đã dùng hết 30 lượt/24h — không gọi LLM, không ghi ChatHistory mới", async () => {
    const user = await seedUser(FIREBASE_UID_A, "chat-test-a@example.com");
    await prisma.aiUsageLog.createMany({
      data: Array.from({ length: 30 }, () => ({ userId: user.id, feature: "chat", tokensInput: 10, tokensOutput: 10, costUsd: 0 })),
    });
    const llmProvider = makeFakeLlmProvider();

    const result = await sendChatMessage(user.id, undefined, "Xin chào", llmProvider);

    expect(result.status).toBe(429);
    expect(llmProvider.generateText).not.toHaveBeenCalled();
    const messages = await prisma.chatHistory.findMany({ where: { userId: user.id } });
    expect(messages).toHaveLength(0);
  });

  it("happy path — không truyền sessionId thì tự tạo mới, ghi đúng 2 dòng ChatHistory + 1 AiUsageLog", async () => {
    const user = await seedUser(FIREBASE_UID_A, "chat-test-a@example.com");
    const llmProvider = makeFakeLlmProvider();

    const result = await sendChatMessage(user.id, undefined, "Xin chào", llmProvider);

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.sessionId).toBeTruthy();
    expect(result.body.reply.content).toBe("Đây là câu trả lời giả cho test.");

    const messages = await prisma.chatHistory.findMany({
      where: { userId: user.id, sessionId: result.body.sessionId },
      orderBy: { createdAt: "asc" },
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("USER");
    expect(messages[0]?.content).toBe("Xin chào");
    expect(messages[1]?.role).toBe("ASSISTANT");

    const usage = await prisma.aiUsageLog.findMany({ where: { userId: user.id, feature: "chat" } });
    expect(usage).toHaveLength(1);
    expect(usage[0]?.tokensInput).toBe(100);
  });

  it("tiếp tục đúng session khi truyền sessionId có sẵn — lịch sử cũ được đưa vào prompt", async () => {
    const user = await seedUser(FIREBASE_UID_A, "chat-test-a@example.com");
    const sessionId = "existing-session-1";
    await prisma.chatHistory.create({ data: { userId: user.id, sessionId, role: "USER", content: "Câu hỏi đầu tiên" } });
    await prisma.chatHistory.create({ data: { userId: user.id, sessionId, role: "ASSISTANT", content: "Câu trả lời đầu tiên" } });
    const llmProvider = makeFakeLlmProvider();

    const result = await sendChatMessage(user.id, sessionId, "Câu hỏi thứ hai", llmProvider);

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.sessionId).toBe(sessionId);

    const promptArg = (llmProvider.generateText as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(promptArg.prompt).toContain("Câu hỏi đầu tiên");
    expect(promptArg.prompt).toContain("Câu trả lời đầu tiên");
    expect(promptArg.prompt).toContain("Câu hỏi thứ hai");

    const messages = await prisma.chatHistory.findMany({ where: { userId: user.id, sessionId } });
    expect(messages).toHaveLength(4); // 2 cũ + 2 mới (user+assistant)
  });

  it("retrieval — message chứa tên đội có AiMatchSummary thì prompt nhận được có chứa nội dung summary đó", async () => {
    const user = await seedUser(FIREBASE_UID_A, "chat-test-a@example.com");
    const { team, summaryContent } = await seedTeamWithSummary("RetrievalFC");
    const llmProvider = makeFakeLlmProvider();

    const result = await sendChatMessage(user.id, undefined, `${team.name} đá thế nào rồi?`, llmProvider);

    expect(result.status).toBe(200);
    const promptArg = (llmProvider.generateText as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(promptArg.prompt).toContain(summaryContent);
  });
});

describe("POST /chat/messages (HTTP-level)", () => {
  it("401 khi chưa có bearer token", async () => {
    const res = await app.request("/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Xin chào" }),
    });
    expect(res.status).toBe(401);
  });

  it("400 khi message rỗng hoặc quá dài", async () => {
    const empty = await app.request("/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_A}` },
      body: JSON.stringify({ message: "" }),
    });
    expect(empty.status).toBe(400);

    const tooLong = await app.request("/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_A}` },
      body: JSON.stringify({ message: "a".repeat(2001) }),
    });
    expect(tooLong.status).toBe(400);
  });

  it("201/200 happy path qua HTTP thật", async () => {
    const res = await app.request("/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_A}` },
      body: JSON.stringify({ message: "Xin chào" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string; reply: { content: string } };
    expect(body.sessionId).toBeTruthy();
    expect(body.reply.content).toBe("Đây là câu trả lời giả cho test.");
  });
});

describe("GET /chat/sessions", () => {
  it("401 khi chưa có bearer token", async () => {
    const res = await app.request("/chat/sessions");
    expect(res.status).toBe(401);
  });

  it("chỉ trả session của đúng user hiện tại, không lẫn session user khác", async () => {
    const userA = await seedUser(FIREBASE_UID_A, "chat-test-a@example.com");
    const userB = await seedUser(FIREBASE_UID_B, "chat-test-b@example.com");
    await prisma.chatHistory.create({ data: { userId: userA.id, sessionId: "session-a", role: "USER", content: "hi from a" } });
    await prisma.chatHistory.create({ data: { userId: userB.id, sessionId: "session-b", role: "USER", content: "hi from b" } });

    const res = await app.request("/chat/sessions", { headers: { Authorization: `Bearer ${TOKEN_A}` } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: { sessionId: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(data.items[0]?.sessionId).toBe("session-a");
  });
});

describe("GET /chat/sessions/:sessionId/messages", () => {
  it("401 khi chưa có bearer token", async () => {
    const res = await app.request("/chat/sessions/some-session/messages");
    expect(res.status).toBe(401);
  });

  it("trả rỗng khi sessionId thuộc user khác (không lộ nội dung)", async () => {
    const userA = await seedUser(FIREBASE_UID_A, "chat-test-a@example.com");
    const userB = await seedUser(FIREBASE_UID_B, "chat-test-b@example.com");
    await prisma.chatHistory.create({
      data: { userId: userB.id, sessionId: "session-b-only", role: "USER", content: "bí mật của user B" },
    });
    void userA;

    const res = await app.request("/chat/sessions/session-b-only/messages", {
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: unknown[] };
    expect(data.items).toHaveLength(0);
  });

  it("trả đúng message theo thứ tự thời gian cho session của chính user", async () => {
    const user = await seedUser(FIREBASE_UID_A, "chat-test-a@example.com");
    await prisma.chatHistory.create({ data: { userId: user.id, sessionId: "session-mine", role: "USER", content: "câu 1" } });
    await prisma.chatHistory.create({ data: { userId: user.id, sessionId: "session-mine", role: "ASSISTANT", content: "trả lời 1" } });

    const res = await app.request("/chat/sessions/session-mine/messages", {
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: { role: string; content: string }[] };
    expect(data.items).toHaveLength(2);
    expect(data.items[0]?.content).toBe("câu 1");
    expect(data.items[1]?.content).toBe("trả lời 1");
  });
});
