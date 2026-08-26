import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../app";
import { signAdminToken } from "../middleware/admin-auth";

const PROVIDER = "statistics-admin-test-provider";
const ref = (id: string) => ({ provider: PROVIDER, id });
const ADMIN_USERNAME = "statistics-admin-test-admin";
process.env.ADMIN_JWT_SECRET ??= "statistics-admin-test-secret";

async function seedAdmin() {
  return prisma.adminUser.create({ data: { username: ADMIN_USERNAME, passwordHash: "unused" } });
}

async function cleanupTestData() {
  await prisma.cleanSheet.deleteMany({ where: { season: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } } });
  await prisma.teamStatistics.deleteMany({
    where: { season: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } },
  });
  await prisma.match.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.season.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.competition.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.adminUser.deleteMany({ where: { username: ADMIN_USERNAME } });
}

beforeEach(cleanupTestData);
afterAll(cleanupTestData);

describe("POST /admin/team-statistics/recompute", () => {
  it("401 khi chưa có bearer token", async () => {
    const res = await app.request("/admin/team-statistics/recompute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamIds: ["x"], seasonId: "y" }),
    });

    expect(res.status).toBe(401);
  });

  it("recompute lại toàn mùa rồi trả về thống kê của nhiều đội được chọn cùng lúc", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);

    const competition = await prisma.competition.create({
      data: { name: "Statistics Admin Test League", type: "LEAGUE", externalRef: ref("comp") as object },
    });
    const season = await prisma.season.create({
      data: {
        competitionId: competition.id,
        name: "2025/2026",
        startDate: new Date("2025-08-01T00:00:00.000Z"),
        endDate: new Date("2026-05-31T00:00:00.000Z"),
      },
    });
    const [teamA, teamB, teamC] = await Promise.all([
      prisma.team.create({ data: { name: "Team A", externalRef: ref("team-a") as object } }),
      prisma.team.create({ data: { name: "Team B", externalRef: ref("team-b") as object } }),
      prisma.team.create({ data: { name: "Team C", externalRef: ref("team-c") as object } }),
    ]);

    await prisma.teamStatistics.create({
      data: {
        teamId: teamA.id,
        seasonId: season.id,
        wins: 99,
        draws: 99,
        losses: 99,
        goalsFor: 99,
        goalsAgainst: 99,
        cleanSheets: 99,
      },
    });

    await prisma.match.createMany({
      data: [
        {
          competitionId: competition.id,
          seasonId: season.id,
          homeTeamId: teamA.id,
          awayTeamId: teamB.id,
          kickoffAt: new Date("2025-09-01T10:00:00.000Z"),
          status: "FINISHED",
          homeScore: 2,
          awayScore: 0,
          externalRef: ref("match-1") as object,
        },
        {
          competitionId: competition.id,
          seasonId: season.id,
          homeTeamId: teamC.id,
          awayTeamId: teamA.id,
          kickoffAt: new Date("2025-09-08T10:00:00.000Z"),
          status: "FINISHED",
          homeScore: 1,
          awayScore: 1,
          externalRef: ref("match-2") as object,
        },
        {
          competitionId: competition.id,
          seasonId: season.id,
          homeTeamId: teamA.id,
          awayTeamId: teamC.id,
          kickoffAt: new Date("2025-09-15T10:00:00.000Z"),
          status: "FINISHED",
          homeScore: 0,
          awayScore: 0,
          externalRef: ref("match-3") as object,
        },
      ],
    });

    const res = await app.request("/admin/team-statistics/recompute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ teamIds: [teamA.id, teamB.id], seasonId: season.id }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      season: { id: string; name: string; competition: { id: string; name: string } };
      results: {
        team: { id: string; name: string };
        hasMatches: boolean;
        statistics: {
          teamId: string;
          seasonId: string;
          wins: number;
          draws: number;
          losses: number;
          goalsFor: number;
          goalsAgainst: number;
          cleanSheets: number;
        } | null;
        cleanSheetRank: number | null;
        cleanSheetCount: number;
      }[];
      summary: { processedMatches: number; skippedMatches: number; seasonTeamsUpdated: number };
    };

    expect(body.season.name).toBe("2025/2026");
    expect(body.season.competition.name).toBe("Statistics Admin Test League");
    expect(body.summary).toEqual({ processedMatches: 3, skippedMatches: 0, seasonTeamsUpdated: 3 });
    expect(body.results).toHaveLength(2);

    const resultA = body.results.find((r) => r.team.id === teamA.id)!;
    expect(resultA.hasMatches).toBe(true);
    expect(resultA.statistics).toMatchObject({
      teamId: teamA.id,
      seasonId: season.id,
      wins: 1,
      draws: 2,
      losses: 0,
      goalsFor: 3,
      goalsAgainst: 1,
      cleanSheets: 2,
    });
    expect(resultA.cleanSheetRank).toBe(1);
    expect(resultA.cleanSheetCount).toBe(2);

    const resultB = body.results.find((r) => r.team.id === teamB.id)!;
    expect(resultB.hasMatches).toBe(true);
    expect(resultB.statistics).toMatchObject({ wins: 0, draws: 0, losses: 1, goalsFor: 0, goalsAgainst: 2 });

    const savedStats = await prisma.teamStatistics.findUniqueOrThrow({
      where: { teamId_seasonId: { teamId: teamA.id, seasonId: season.id } },
    });
    expect(savedStats).toMatchObject({
      wins: 1,
      draws: 2,
      losses: 0,
      goalsFor: 3,
      goalsAgainst: 1,
      cleanSheets: 2,
    });

    const cleanSheetRow = await prisma.cleanSheet.findUniqueOrThrow({
      where: { seasonId_teamId: { seasonId: season.id, teamId: teamA.id } },
    });
    expect(cleanSheetRow).toMatchObject({ count: 2, rank: 1 });
  });

  it("404 team not found khi 1 trong nhiều teamId không tồn tại", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);

    const competition = await prisma.competition.create({
      data: { name: "Statistics Admin Test League", type: "LEAGUE", externalRef: ref("comp") as object },
    });
    const season = await prisma.season.create({
      data: {
        competitionId: competition.id,
        name: "2025/2026",
        startDate: new Date("2025-08-01T00:00:00.000Z"),
        endDate: new Date("2026-05-31T00:00:00.000Z"),
      },
    });
    const teamA = await prisma.team.create({ data: { name: "Team A", externalRef: ref("team-a") as object } });

    const res = await app.request("/admin/team-statistics/recompute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ teamIds: [teamA.id, "does-not-exist"], seasonId: season.id }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; teamIds: string[] };
    expect(body.teamIds).toEqual(["does-not-exist"]);
  });

  it("hasMatches: false cho đội không có trận FINISHED-có-tỉ-số nào, KHÔNG chặn kết quả của đội khác trong cùng batch", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);

    const competition = await prisma.competition.create({
      data: { name: "Statistics Admin Test League", type: "LEAGUE", externalRef: ref("comp") as object },
    });
    const season = await prisma.season.create({
      data: {
        competitionId: competition.id,
        name: "2025/2026",
        startDate: new Date("2025-08-01T00:00:00.000Z"),
        endDate: new Date("2026-05-31T00:00:00.000Z"),
      },
    });
    const [teamA, teamB, noMatchTeam] = await Promise.all([
      prisma.team.create({ data: { name: "Team A", externalRef: ref("team-a") as object } }),
      prisma.team.create({ data: { name: "Team B", externalRef: ref("team-b") as object } }),
      prisma.team.create({ data: { name: "No Match Team", externalRef: ref("no-match") as object } }),
    ]);

    await prisma.match.create({
      data: {
        competitionId: competition.id,
        seasonId: season.id,
        homeTeamId: teamA.id,
        awayTeamId: teamB.id,
        kickoffAt: new Date("2025-09-01T10:00:00.000Z"),
        status: "FINISHED",
        homeScore: 1,
        awayScore: 0,
        externalRef: ref("match-1") as object,
      },
    });

    const res = await app.request("/admin/team-statistics/recompute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ teamIds: [teamA.id, noMatchTeam.id], seasonId: season.id }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { team: { id: string }; hasMatches: boolean; statistics: unknown }[];
    };

    const resultA = body.results.find((r) => r.team.id === teamA.id)!;
    expect(resultA.hasMatches).toBe(true);
    expect(resultA.statistics).not.toBeNull();

    const resultNoMatch = body.results.find((r) => r.team.id === noMatchTeam.id)!;
    expect(resultNoMatch.hasMatches).toBe(false);
    expect(resultNoMatch.statistics).toBeNull();
  });

  it("xoá TeamStatistics/CleanSheet stale của đội không còn trận FINISHED-có-tỉ-số nào trong season", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);

    const competition = await prisma.competition.create({
      data: { name: "Statistics Admin Test League", type: "LEAGUE", externalRef: ref("comp") as object },
    });
    const season = await prisma.season.create({
      data: {
        competitionId: competition.id,
        name: "2025/2026",
        startDate: new Date("2025-08-01T00:00:00.000Z"),
        endDate: new Date("2026-05-31T00:00:00.000Z"),
      },
    });
    const [teamA, teamB, staleTeam] = await Promise.all([
      prisma.team.create({ data: { name: "Team A", externalRef: ref("team-a") as object } }),
      prisma.team.create({ data: { name: "Team B", externalRef: ref("team-b") as object } }),
      prisma.team.create({ data: { name: "Stale Team", externalRef: ref("stale-team") as object } }),
    ]);

    // staleTeam có TeamStatistics + CleanSheet từ 1 lần tính trước, nhưng KHÔNG có trận FINISHED
    // nào trong season này (vd match đã bị xoá/sửa lại status sau đó) — recompute phải dọn sạch cả
    // 2 row này, không được giữ lại số liệu stale.
    await prisma.teamStatistics.create({
      data: {
        teamId: staleTeam.id,
        seasonId: season.id,
        wins: 5,
        draws: 5,
        losses: 5,
        goalsFor: 50,
        goalsAgainst: 50,
        cleanSheets: 5,
      },
    });
    await prisma.cleanSheet.create({
      data: { seasonId: season.id, teamId: staleTeam.id, count: 5, rank: 1 },
    });

    await prisma.match.create({
      data: {
        competitionId: competition.id,
        seasonId: season.id,
        homeTeamId: teamA.id,
        awayTeamId: teamB.id,
        kickoffAt: new Date("2025-09-01T10:00:00.000Z"),
        status: "FINISHED",
        homeScore: 1,
        awayScore: 0,
        externalRef: ref("match-1") as object,
      },
    });

    const res = await app.request("/admin/team-statistics/recompute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ teamIds: [teamA.id], seasonId: season.id }),
    });
    expect(res.status).toBe(200);

    const staleStats = await prisma.teamStatistics.findUnique({
      where: { teamId_seasonId: { teamId: staleTeam.id, seasonId: season.id } },
    });
    expect(staleStats).toBeNull();

    const staleCleanSheet = await prisma.cleanSheet.findUnique({
      where: { seasonId_teamId: { seasonId: season.id, teamId: staleTeam.id } },
    });
    expect(staleCleanSheet).toBeNull();
  });
});
