import type {
  CanonicalCompetition,
  CanonicalMatch,
  CanonicalPlayer,
  CanonicalSeason,
  CanonicalStandingRow,
  CanonicalTeam,
  DataProviderAdapter,
  ExternalRef,
} from "@football-app/data-provider";
import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  syncCompetitions,
  syncMatches,
  syncPlayers,
  syncSeasons,
  syncStandings,
  syncTeams,
} from "./sync-catalog";

// Test chạy against Postgres thật (Docker) — xem CLAUDE.md § Docker để có DATABASE_URL đúng.
// Dùng mock adapter (không gọi API-Football thật) để verify logic sync/upsert độc lập với
// việc có API key thật hay không, xem CLAUDE.md ghi chú "chưa có API key".

const PROVIDER = "test-provider";
const PROVIDER_B = "test-provider-b";
const ref = (id: string): ExternalRef => ({ provider: PROVIDER, id });

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
      throw new Error("not used in catalog sync tests");
    },
    fetchMatchEvents: async () => [],
    fetchStandings: async () => [],
    ...overrides,
  };
}

const COMPETITION_EXT = ref("comp-1");
const SEASON_EXT = ref("2025");
const TEAM_A_EXT = ref("team-a");
const TEAM_B_EXT = ref("team-b");

const competition: CanonicalCompetition = {
  externalRef: COMPETITION_EXT,
  name: "Test League",
  type: "LEAGUE",
  countryCode: "VN",
  logoUrl: "https://example.com/logo.png",
};

const season: CanonicalSeason = {
  externalRef: SEASON_EXT,
  competitionExternalRef: COMPETITION_EXT,
  name: "2025",
  startDate: "2025-08-01",
  endDate: "2026-05-01",
  isCurrent: true,
};

const teamA: CanonicalTeam = {
  externalRef: TEAM_A_EXT,
  name: "Team A",
  shortName: "TMA",
  countryCode: "VN",
  founded: 1990,
};

const teamB: CanonicalTeam = {
  externalRef: TEAM_B_EXT,
  name: "Team B",
  shortName: "TMB",
  countryCode: "VN",
  founded: 1995,
};

async function cleanupTestData() {
  for (const provider of [PROVIDER, PROVIDER_B]) {
    await prisma.standing.deleteMany({ where: { team: { externalRef: { path: ["provider"], equals: provider } } } });
    await prisma.match.deleteMany({ where: { externalRef: { path: ["provider"], equals: provider } } });
    await prisma.player.deleteMany({ where: { externalRef: { path: ["provider"], equals: provider } } });
    await prisma.season.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: provider } } } });
    await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: provider } } });
    await prisma.competition.deleteMany({ where: { externalRef: { path: ["provider"], equals: provider } } });
  }
}

beforeEach(cleanupTestData);
afterAll(cleanupTestData);

describe("syncCompetitions", () => {
  it("tạo competition mới, rồi update khi chạy lại (không tạo trùng)", async () => {
    const adapter = makeMockAdapter({ fetchCompetitions: async () => [competition] });

    const first = await syncCompetitions(adapter);
    expect(first.syncedCount).toBe(1);

    const updatedAdapter = makeMockAdapter({
      fetchCompetitions: async () => [{ ...competition, name: "Test League Updated" }],
    });
    const second = await syncCompetitions(updatedAdapter);
    expect(second.syncedCount).toBe(1);

    const rows = await prisma.competition.findMany({
      where: {
        AND: [
          { externalRef: { path: ["provider"], equals: PROVIDER } },
          { externalRef: { path: ["id"], equals: COMPETITION_EXT.id } },
        ],
      },
    });
    expect(rows).toHaveLength(1); // không tạo trùng
    expect(rows[0]?.name).toBe("Test League Updated"); // update áp dụng
  });
});

describe("syncSeasons", () => {
  it("throw nếu competition chưa sync", async () => {
    const adapter = makeMockAdapter({ fetchSeasons: async () => [season] });
    await expect(syncSeasons(adapter, COMPETITION_EXT)).rejects.toThrow(/chưa được sync/);
  });

  it("tạo season đúng competitionId sau khi competition đã sync", async () => {
    await syncCompetitions(makeMockAdapter({ fetchCompetitions: async () => [competition] }));

    const adapter = makeMockAdapter({ fetchSeasons: async () => [season] });
    const result = await syncSeasons(adapter, COMPETITION_EXT);
    expect(result.syncedCount).toBe(1);

    const dbCompetition = await prisma.competition.findFirst({
      where: { externalRef: { path: ["id"], equals: COMPETITION_EXT.id } },
    });
    const dbSeason = await prisma.season.findFirst({ where: { competitionId: dbCompetition?.id } });
    expect(dbSeason?.name).toBe("2025");
    expect(dbSeason?.isCurrent).toBe(true);
  });
});

describe("syncTeams + syncPlayers", () => {
  it("sync team rồi player, throw nếu sync player trước khi team tồn tại", async () => {
    const player: CanonicalPlayer = {
      externalRef: ref("player-1"),
      name: "Player One",
      nationality: "VN",
      position: "Forward",
    };
    const adapterPlayersOnly = makeMockAdapter({ fetchPlayers: async () => [player] });
    await expect(syncPlayers(adapterPlayersOnly, TEAM_A_EXT, SEASON_EXT)).rejects.toThrow(/chưa được sync/);

    const adapterTeams = makeMockAdapter({ fetchTeams: async () => [teamA, teamB] });
    const teamsResult = await syncTeams(adapterTeams, COMPETITION_EXT, SEASON_EXT);
    expect(teamsResult.syncedCount).toBe(2);

    const playersResult = await syncPlayers(adapterPlayersOnly, TEAM_A_EXT, SEASON_EXT);
    expect(playersResult.syncedCount).toBe(1);

    const dbTeamA = await prisma.team.findFirst({ where: { externalRef: { path: ["id"], equals: TEAM_A_EXT.id } } });
    const dbPlayer = await prisma.player.findFirst({ where: { externalRef: { path: ["id"], equals: "player-1" } } });
    expect(dbPlayer?.teamId).toBe(dbTeamA?.id);
    expect(dbPlayer?.position).toBe("Forward");
  });
});

describe("syncStandings + syncMatches", () => {
  it("sync standings/matches đúng FK, bỏ qua team lạ chưa sync", async () => {
    await syncCompetitions(makeMockAdapter({ fetchCompetitions: async () => [competition] }));
    await syncSeasons(makeMockAdapter({ fetchSeasons: async () => [season] }), COMPETITION_EXT);
    await syncTeams(makeMockAdapter({ fetchTeams: async () => [teamA, teamB] }), COMPETITION_EXT, SEASON_EXT);

    const standingRows: CanonicalStandingRow[] = [
      { seasonExternalRef: SEASON_EXT, teamExternalRef: TEAM_A_EXT, position: 1, played: 5, win: 4, draw: 1, loss: 0, gf: 10, ga: 2, points: 13 },
      { seasonExternalRef: SEASON_EXT, teamExternalRef: ref("unknown-team"), position: 2, played: 5, win: 3, draw: 1, loss: 1, gf: 8, ga: 5, points: 10 },
    ];
    const standingsResult = await syncStandings(
      makeMockAdapter({ fetchStandings: async () => standingRows }),
      COMPETITION_EXT,
      SEASON_EXT,
    );
    expect(standingsResult.syncedCount).toBe(1);
    expect(standingsResult.skipped).toBe(1);

    const dbTeamA = await prisma.team.findFirst({ where: { externalRef: { path: ["id"], equals: TEAM_A_EXT.id } } });
    const dbStanding = await prisma.standing.findFirst({ where: { teamId: dbTeamA?.id } });
    expect(dbStanding?.points).toBe(13);
    expect(dbStanding?.gd).toBe(8);

    const match: CanonicalMatch = {
      externalRef: ref("match-1"),
      competitionExternalRef: COMPETITION_EXT,
      seasonExternalRef: SEASON_EXT,
      homeTeamExternalRef: TEAM_A_EXT,
      awayTeamExternalRef: TEAM_B_EXT,
      kickoffAt: "2025-09-01T10:00:00.000Z",
      status: "FINISHED",
      homeScore: 2,
      awayScore: 1,
    };
    const matchWithUnknownTeam: CanonicalMatch = {
      ...match,
      externalRef: ref("match-2"),
      awayTeamExternalRef: ref("unknown-team"),
    };
    const matchesResult = await syncMatches(
      makeMockAdapter({ fetchMatches: async () => [match, matchWithUnknownTeam] }),
      COMPETITION_EXT,
      SEASON_EXT,
    );
    expect(matchesResult.syncedCount).toBe(1);
    expect(matchesResult.skipped).toBe(1);

    const dbMatch = await prisma.match.findFirst({
      where: { externalRef: { path: ["id"], equals: "match-1" } },
    });
    expect(dbMatch?.status).toBe("FINISHED");
    expect(dbMatch?.homeScore).toBe(2);
    expect(dbMatch?.awayScore).toBe(1);
  });
});

describe("cross-provider id collision (regression, xem bug ghi ở CLAUDE.md § Database)", () => {
  it("2 provider khác nhau dùng chung numeric id -> tạo 2 competition riêng biệt, không match nhầm", async () => {
    // Cả 2 provider dùng cùng id số "collide-1" — trước khi fix, findCompetitionByExternalId chỉ
    // filter theo `id` nên lần sync thứ 2 (provider B) sẽ nhầm match vào row của provider A và
    // overwrite `name` của nó thay vì tạo row mới.
    const collidingId = "collide-1";
    const competitionA: CanonicalCompetition = {
      externalRef: { provider: PROVIDER, id: collidingId },
      name: "Provider A League",
      type: "LEAGUE",
      countryCode: "VN",
    };
    const competitionB: CanonicalCompetition = {
      externalRef: { provider: PROVIDER_B, id: collidingId },
      name: "Provider B League",
      type: "LEAGUE",
      countryCode: "US",
    };

    await syncCompetitions(makeMockAdapter({ providerName: PROVIDER, fetchCompetitions: async () => [competitionA] }));
    await syncCompetitions(
      makeMockAdapter({ providerName: PROVIDER_B, fetchCompetitions: async () => [competitionB] }),
    );

    const dbCompetitionA = await prisma.competition.findFirst({
      where: {
        AND: [
          { externalRef: { path: ["provider"], equals: PROVIDER } },
          { externalRef: { path: ["id"], equals: collidingId } },
        ],
      },
    });
    const dbCompetitionB = await prisma.competition.findFirst({
      where: {
        AND: [
          { externalRef: { path: ["provider"], equals: PROVIDER_B } },
          { externalRef: { path: ["id"], equals: collidingId } },
        ],
      },
    });

    expect(dbCompetitionA).not.toBeNull();
    expect(dbCompetitionB).not.toBeNull();
    expect(dbCompetitionA?.id).not.toBe(dbCompetitionB?.id); // 2 row riêng biệt, không phải cùng 1 row
    expect(dbCompetitionA?.name).toBe("Provider A League"); // không bị provider B overwrite
    expect(dbCompetitionB?.name).toBe("Provider B League");
  });
});
