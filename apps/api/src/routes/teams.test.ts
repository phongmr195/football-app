import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../app";

const PROVIDER = "teams-route-test-provider";
const ref = (id: string) => ({ provider: PROVIDER, id });

async function cleanupTestData() {
  await prisma.match.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.season.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.competition.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
}

beforeEach(cleanupTestData);
afterAll(cleanupTestData);

describe("GET /teams", () => {
  it("seasonId lọc đúng — chỉ trả đội có ít nhất 1 match (home hoặc away) trong season đó", async () => {
    const competition = await prisma.competition.create({
      data: { name: "Teams Route Test League", type: "LEAGUE", externalRef: ref("comp") as object },
    });
    const season = await prisma.season.create({
      data: {
        competitionId: competition.id,
        name: "2025/2026",
        startDate: new Date("2025-08-01T00:00:00.000Z"),
        endDate: new Date("2026-05-31T00:00:00.000Z"),
      },
    });
    const [teamHome, teamAway, unrelatedTeam] = await Promise.all([
      prisma.team.create({ data: { name: "Teams Route Test Home", externalRef: ref("home") as object } }),
      prisma.team.create({ data: { name: "Teams Route Test Away", externalRef: ref("away") as object } }),
      prisma.team.create({ data: { name: "Teams Route Test Unrelated", externalRef: ref("unrelated") as object } }),
    ]);

    await prisma.match.create({
      data: {
        competitionId: competition.id,
        seasonId: season.id,
        homeTeamId: teamHome.id,
        awayTeamId: teamAway.id,
        kickoffAt: new Date("2025-09-01T10:00:00.000Z"),
        status: "SCHEDULED",
        externalRef: ref("match-1") as object,
      },
    });

    const res = await app.request(`/teams?seasonId=${season.id}&pageSize=50`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; name: string }[] };
    const ids = body.items.map((t) => t.id);

    expect(ids).toContain(teamHome.id);
    expect(ids).toContain(teamAway.id);
    expect(ids).not.toContain(unrelatedTeam.id);
  });
});
