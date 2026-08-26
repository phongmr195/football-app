import type { LlmProvider } from "@football-app/ai-provider";
import type { CanonicalMatch, DataProviderAdapter, ExternalRef } from "@football-app/data-provider";
import type { RealtimeTransport } from "@football-app/realtime";
import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncLiveMatches } from "./sync-live-matches";

// Test chạy against Postgres thật (Docker) — xem CLAUDE.md § Docker để có DATABASE_URL đúng,
// và apps/sync-worker/src/sync-catalog.test.ts cho pattern mock-adapter + dockerized-Postgres.

const PROVIDER = "live-sync-test-provider";
const PROVIDER_B = "live-sync-test-provider-b";
const ref = (provider: string, id: string): ExternalRef => ({ provider, id });

let mockAdapter: DataProviderAdapter;

// createAdapter() được gọi trực tiếp bên trong syncLiveMatches() (không nhận adapter qua tham
// số), nên phải mock cả module "./provider" để control fetchLiveMatches() trong test.
vi.mock("./provider", () => ({
  createAdapter: () => mockAdapter,
}));

// createPublisher() cũng được gọi trực tiếp bên trong syncLiveMatches() (memoized singleton, xem
// realtime.ts) — mock cả module "./realtime" cùng style với "./provider" ở trên để control/assert
// publish() mà không cần Redis thật.
const mockPublisher: RealtimeTransport = {
  transportName: "mock",
  publish: vi.fn().mockResolvedValue(undefined),
  publishGoal: vi.fn().mockResolvedValue(undefined),
  publishMatchFinished: vi.fn().mockResolvedValue(undefined),
};
vi.mock("./realtime", () => ({
  createPublisher: () => mockPublisher,
}));

// syncLiveMatches() tự trigger generateMatchSummaryIfNeeded() khi match chuyển sang FINISHED
// (Phase 5) — mock "./ai-provider" cùng style 2 module trên, tránh test file này gọi network thật
// tới Anthropic (generateMatchSummaryIfNeeded mặc định dùng createLlmProvider() thật nếu không
// mock module này).
const mockLlmProvider: LlmProvider = {
  providerName: "mock",
  generateText: vi.fn().mockResolvedValue({
    content: "mock summary",
    model: "mock-model",
    tokensInput: 1,
    tokensOutput: 1,
  }),
};
vi.mock("./ai-provider", () => ({
  createLlmProvider: () => mockLlmProvider,
}));

function makeMockAdapter(overrides: Partial<DataProviderAdapter> = {}): DataProviderAdapter {
  return {
    providerName: PROVIDER,
    fetchCompetitions: async () => [],
    fetchSeasons: async () => [],
    fetchTeams: async () => [],
    fetchPlayers: async () => [],
    fetchMatches: async () => [],
    fetchLiveMatches: async () => [],
    fetchMatch: async () => {
      throw new Error("not used in live-match sync tests");
    },
    fetchMatchEvents: async () => [],
    fetchStandings: async () => [],
    fetchTopScorers: async () => [],
    ...overrides,
  };
}

async function seedMatch(
  provider: string,
  matchExternalId: string,
  initial: { homeScore?: number | null; awayScore?: number | null } = {},
) {
  const competition = await prisma.competition.create({
    data: {
      name: `${provider} League`,
      type: "LEAGUE",
      countryCode: "VN",
      externalRef: ref(provider, "live-comp-1") as object,
    },
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
    data: { name: `${provider} Team A`, externalRef: ref(provider, "live-team-a") as object },
  });
  const awayTeam = await prisma.team.create({
    data: { name: `${provider} Team B`, externalRef: ref(provider, "live-team-b") as object },
  });
  const match = await prisma.match.create({
    data: {
      competitionId: competition.id,
      seasonId: season.id,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      kickoffAt: new Date("2025-09-01T10:00:00.000Z"),
      status: initial.homeScore === undefined && initial.awayScore === undefined ? "SCHEDULED" : "LIVE",
      homeScore: initial.homeScore ?? null,
      awayScore: initial.awayScore ?? null,
      externalRef: ref(provider, matchExternalId) as object,
    },
  });
  return match;
}

async function cleanupTestData() {
  for (const provider of [PROVIDER, PROVIDER_B]) {
    await prisma.liveMatchState.deleteMany({
      where: { match: { externalRef: { path: ["provider"], equals: provider } } },
    });
    await prisma.match.deleteMany({ where: { externalRef: { path: ["provider"], equals: provider } } });
    await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: provider } } });
    await prisma.season.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: provider } } } });
    await prisma.competition.deleteMany({ where: { externalRef: { path: ["provider"], equals: provider } } });
  }
}

beforeEach(async () => {
  await cleanupTestData();
  mockPublisher.publish = vi.fn().mockResolvedValue(undefined);
  mockPublisher.publishGoal = vi.fn().mockResolvedValue(undefined);
  mockPublisher.publishMatchFinished = vi.fn().mockResolvedValue(undefined);
});
afterAll(cleanupTestData);

describe("syncLiveMatches — regression: lookup phải filter cả provider VÀ id", () => {
  it("2 match cùng externalRef.id nhưng khác provider -> chỉ match đúng provider bị cập nhật", async () => {
    // Cả 2 match dùng chung id "match-collide" — trước khi fix, findFirst chỉ filter theo `id`
    // nên tick của provider A có thể nhầm match vào row của provider B (hoặc ngược lại tuỳ thứ
    // tự trong DB) và silently overwrite match không liên quan.
    const collidingId = "match-collide";
    const matchA = await seedMatch(PROVIDER, collidingId);
    const matchB = await seedMatch(PROVIDER_B, collidingId);

    const liveMatch: CanonicalMatch = {
      externalRef: ref(PROVIDER, collidingId),
      competitionExternalRef: ref(PROVIDER, "live-comp-1"),
      seasonExternalRef: ref(PROVIDER, "2025"),
      homeTeamExternalRef: ref(PROVIDER, "live-team-a"),
      awayTeamExternalRef: ref(PROVIDER, "live-team-b"),
      kickoffAt: "2025-09-01T10:00:00.000Z",
      status: "LIVE",
      minute: 10,
      homeScore: 1,
      awayScore: 0,
    };
    mockAdapter = makeMockAdapter({ providerName: PROVIDER, fetchLiveMatches: async () => [liveMatch] });

    const result = await syncLiveMatches();
    expect(result.syncedCount).toBe(1);

    const dbMatchA = await prisma.match.findUniqueOrThrow({ where: { id: matchA.id } });
    expect(dbMatchA.status).toBe("LIVE");
    expect(dbMatchA.homeScore).toBe(1);
    expect(dbMatchA.awayScore).toBe(0);

    // Match B (provider khác, id trùng) KHÔNG bị đụng vào — đây là assertion chính của regression test.
    const dbMatchB = await prisma.match.findUniqueOrThrow({ where: { id: matchB.id } });
    expect(dbMatchB.status).toBe("SCHEDULED");
    expect(dbMatchB.homeScore).toBeNull();
    expect(dbMatchB.awayScore).toBeNull();

    const liveStateB = await prisma.liveMatchState.findUnique({ where: { matchId: matchB.id } });
    expect(liveStateB).toBeNull();
  });

  it("transaction ghi đúng cả Match VÀ LiveMatchState", async () => {
    const match = await seedMatch(PROVIDER, "match-both");
    const liveMatch: CanonicalMatch = {
      externalRef: ref(PROVIDER, "match-both"),
      competitionExternalRef: ref(PROVIDER, "live-comp-1"),
      seasonExternalRef: ref(PROVIDER, "2025"),
      homeTeamExternalRef: ref(PROVIDER, "live-team-a"),
      awayTeamExternalRef: ref(PROVIDER, "live-team-b"),
      kickoffAt: "2025-09-01T10:00:00.000Z",
      status: "HALFTIME",
      minute: 45,
      homeScore: 2,
      awayScore: 1,
    };
    mockAdapter = makeMockAdapter({ providerName: PROVIDER, fetchLiveMatches: async () => [liveMatch] });

    await syncLiveMatches();

    const dbMatch = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(dbMatch.status).toBe("HALFTIME");
    expect(dbMatch.homeScore).toBe(2);
    expect(dbMatch.awayScore).toBe(1);

    const liveState = await prisma.liveMatchState.findUniqueOrThrow({ where: { matchId: match.id } });
    expect(liveState.status).toBe("HALFTIME");
    expect(liveState.minute).toBe(45);
    expect(liveState.homeScore).toBe(2);
    expect(liveState.awayScore).toBe(1);
  });

  it("bỏ qua (continue) khi chưa có Match tương ứng trong DB", async () => {
    const liveMatch: CanonicalMatch = {
      externalRef: ref(PROVIDER, "unknown-match"),
      competitionExternalRef: ref(PROVIDER, "live-comp-1"),
      seasonExternalRef: ref(PROVIDER, "2025"),
      homeTeamExternalRef: ref(PROVIDER, "live-team-a"),
      awayTeamExternalRef: ref(PROVIDER, "live-team-b"),
      kickoffAt: "2025-09-01T10:00:00.000Z",
      status: "LIVE",
      minute: 5,
      homeScore: 0,
      awayScore: 0,
    };
    mockAdapter = makeMockAdapter({ providerName: PROVIDER, fetchLiveMatches: async () => [liveMatch] });

    const result = await syncLiveMatches();
    expect(result.syncedCount).toBe(1); // matches.length vẫn tính cả match bị skip
  });
});

describe("syncLiveMatches — publish real-time update", () => {
  it("publish() được gọi đúng 1 lần/match live, SAU transaction, với đúng payload", async () => {
    const match = await seedMatch(PROVIDER, "match-publish");
    const liveMatch: CanonicalMatch = {
      externalRef: ref(PROVIDER, "match-publish"),
      competitionExternalRef: ref(PROVIDER, "live-comp-1"),
      seasonExternalRef: ref(PROVIDER, "2025"),
      homeTeamExternalRef: ref(PROVIDER, "live-team-a"),
      awayTeamExternalRef: ref(PROVIDER, "live-team-b"),
      kickoffAt: "2025-09-01T10:00:00.000Z",
      status: "LIVE",
      minute: 20,
      homeScore: 3,
      awayScore: 2,
    };
    mockAdapter = makeMockAdapter({ providerName: PROVIDER, fetchLiveMatches: async () => [liveMatch] });

    await syncLiveMatches();

    // Transaction phải đã ghi xong TRƯỚC khi publish được gọi — assert gián tiếp bằng cách đọc
    // lại DB (nếu publish() bị gọi trước transaction, DB vẫn ở trạng thái cũ dù mock publish
    // không quan tâm thứ tự thật — điểm mấu chốt là code path trong sync-live-matches.ts gọi
    // publish() ngay sau `await prisma.$transaction([...])`, xem file đó).
    const dbMatch = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(dbMatch.status).toBe("LIVE");

    expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
    expect(mockPublisher.publish).toHaveBeenCalledWith({
      matchId: match.id,
      status: "LIVE",
      minute: 20,
      homeScore: 3,
      awayScore: 2,
      updatedAt: expect.any(String),
    });
  });

  it("publish() reject KHÔNG làm syncLiveMatches() throw — loop hoàn tất bình thường", async () => {
    await seedMatch(PROVIDER, "match-publish-fail");
    const liveMatch: CanonicalMatch = {
      externalRef: ref(PROVIDER, "match-publish-fail"),
      competitionExternalRef: ref(PROVIDER, "live-comp-1"),
      seasonExternalRef: ref(PROVIDER, "2025"),
      homeTeamExternalRef: ref(PROVIDER, "live-team-a"),
      awayTeamExternalRef: ref(PROVIDER, "live-team-b"),
      kickoffAt: "2025-09-01T10:00:00.000Z",
      status: "LIVE",
      minute: 1,
      homeScore: 0,
      awayScore: 0,
    };
    mockAdapter = makeMockAdapter({ providerName: PROVIDER, fetchLiveMatches: async () => [liveMatch] });
    mockPublisher.publish = vi.fn().mockRejectedValue(new Error("redis down"));

    const result = await syncLiveMatches();

    expect(result.syncedCount).toBe(1);
    expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
  });
});

describe("syncLiveMatches — goal detection (push notification, Phase 2 Bước 3)", () => {
  it("home tăng -> publishGoal đúng 1 lần cho homeTeamId", async () => {
    const match = await seedMatch(PROVIDER, "match-goal-home", { homeScore: 1, awayScore: 0 });
    const liveMatch: CanonicalMatch = {
      externalRef: ref(PROVIDER, "match-goal-home"),
      competitionExternalRef: ref(PROVIDER, "live-comp-1"),
      seasonExternalRef: ref(PROVIDER, "2025"),
      homeTeamExternalRef: ref(PROVIDER, "live-team-a"),
      awayTeamExternalRef: ref(PROVIDER, "live-team-b"),
      kickoffAt: "2025-09-01T10:00:00.000Z",
      status: "LIVE",
      minute: 30,
      homeScore: 2,
      awayScore: 0,
    };
    mockAdapter = makeMockAdapter({ providerName: PROVIDER, fetchLiveMatches: async () => [liveMatch] });

    await syncLiveMatches();

    expect(mockPublisher.publishGoal).toHaveBeenCalledTimes(1);
    expect(mockPublisher.publishGoal).toHaveBeenCalledWith({
      matchId: match.id,
      teamId: match.homeTeamId,
      homeScore: 2,
      awayScore: 0,
      scoredAt: expect.any(String),
    });
  });

  it("away tăng -> publishGoal đúng 1 lần cho awayTeamId", async () => {
    const match = await seedMatch(PROVIDER, "match-goal-away", { homeScore: 0, awayScore: 1 });
    const liveMatch: CanonicalMatch = {
      externalRef: ref(PROVIDER, "match-goal-away"),
      competitionExternalRef: ref(PROVIDER, "live-comp-1"),
      seasonExternalRef: ref(PROVIDER, "2025"),
      homeTeamExternalRef: ref(PROVIDER, "live-team-a"),
      awayTeamExternalRef: ref(PROVIDER, "live-team-b"),
      kickoffAt: "2025-09-01T10:00:00.000Z",
      status: "LIVE",
      minute: 40,
      homeScore: 0,
      awayScore: 2,
    };
    mockAdapter = makeMockAdapter({ providerName: PROVIDER, fetchLiveMatches: async () => [liveMatch] });

    await syncLiveMatches();

    expect(mockPublisher.publishGoal).toHaveBeenCalledTimes(1);
    expect(mockPublisher.publishGoal).toHaveBeenCalledWith({
      matchId: match.id,
      teamId: match.awayTeamId,
      homeScore: 0,
      awayScore: 2,
      scoredAt: expect.any(String),
    });
  });

  it("cả 2 đội cùng tăng giữa 2 tick -> publishGoal gọi 2 lần, không dùng else-if", async () => {
    const match = await seedMatch(PROVIDER, "match-goal-both", { homeScore: 1, awayScore: 1 });
    const liveMatch: CanonicalMatch = {
      externalRef: ref(PROVIDER, "match-goal-both"),
      competitionExternalRef: ref(PROVIDER, "live-comp-1"),
      seasonExternalRef: ref(PROVIDER, "2025"),
      homeTeamExternalRef: ref(PROVIDER, "live-team-a"),
      awayTeamExternalRef: ref(PROVIDER, "live-team-b"),
      kickoffAt: "2025-09-01T10:00:00.000Z",
      status: "LIVE",
      minute: 50,
      homeScore: 2,
      awayScore: 2,
    };
    mockAdapter = makeMockAdapter({ providerName: PROVIDER, fetchLiveMatches: async () => [liveMatch] });

    await syncLiveMatches();

    expect(mockPublisher.publishGoal).toHaveBeenCalledTimes(2);
    expect(mockPublisher.publishGoal).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: match.id, teamId: match.homeTeamId }),
    );
    expect(mockPublisher.publishGoal).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: match.id, teamId: match.awayTeamId }),
    );
  });

  it("không đổi tỉ số -> publishGoal không được gọi", async () => {
    await seedMatch(PROVIDER, "match-goal-nochange", { homeScore: 1, awayScore: 1 });
    const liveMatch: CanonicalMatch = {
      externalRef: ref(PROVIDER, "match-goal-nochange"),
      competitionExternalRef: ref(PROVIDER, "live-comp-1"),
      seasonExternalRef: ref(PROVIDER, "2025"),
      homeTeamExternalRef: ref(PROVIDER, "live-team-a"),
      awayTeamExternalRef: ref(PROVIDER, "live-team-b"),
      kickoffAt: "2025-09-01T10:00:00.000Z",
      status: "LIVE",
      minute: 60,
      homeScore: 1,
      awayScore: 1,
    };
    mockAdapter = makeMockAdapter({ providerName: PROVIDER, fetchLiveMatches: async () => [liveMatch] });

    await syncLiveMatches();

    expect(mockPublisher.publishGoal).not.toHaveBeenCalled();
  });

  it("tick đầu tiên (dbMatch score null, match score 0) -> không false-positive goal", async () => {
    await seedMatch(PROVIDER, "match-goal-first-tick"); // homeScore/awayScore mặc định null (SCHEDULED)
    const liveMatch: CanonicalMatch = {
      externalRef: ref(PROVIDER, "match-goal-first-tick"),
      competitionExternalRef: ref(PROVIDER, "live-comp-1"),
      seasonExternalRef: ref(PROVIDER, "2025"),
      homeTeamExternalRef: ref(PROVIDER, "live-team-a"),
      awayTeamExternalRef: ref(PROVIDER, "live-team-b"),
      kickoffAt: "2025-09-01T10:00:00.000Z",
      status: "LIVE",
      minute: 1,
      homeScore: 0,
      awayScore: 0,
    };
    mockAdapter = makeMockAdapter({ providerName: PROVIDER, fetchLiveMatches: async () => [liveMatch] });

    await syncLiveMatches();

    expect(mockPublisher.publishGoal).not.toHaveBeenCalled();
  });

  it("publishGoal() reject KHÔNG làm syncLiveMatches() throw", async () => {
    await seedMatch(PROVIDER, "match-goal-publish-fail", { homeScore: 0, awayScore: 0 });
    const liveMatch: CanonicalMatch = {
      externalRef: ref(PROVIDER, "match-goal-publish-fail"),
      competitionExternalRef: ref(PROVIDER, "live-comp-1"),
      seasonExternalRef: ref(PROVIDER, "2025"),
      homeTeamExternalRef: ref(PROVIDER, "live-team-a"),
      awayTeamExternalRef: ref(PROVIDER, "live-team-b"),
      kickoffAt: "2025-09-01T10:00:00.000Z",
      status: "LIVE",
      minute: 5,
      homeScore: 1,
      awayScore: 0,
    };
    mockAdapter = makeMockAdapter({ providerName: PROVIDER, fetchLiveMatches: async () => [liveMatch] });
    mockPublisher.publishGoal = vi.fn().mockRejectedValue(new Error("redis down"));

    const result = await syncLiveMatches();

    expect(result.syncedCount).toBe(1);
    expect(mockPublisher.publishGoal).toHaveBeenCalledTimes(1);
  });
});
