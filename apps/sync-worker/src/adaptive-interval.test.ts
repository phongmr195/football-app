import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { computeNextInterval } from "./adaptive-interval";

// Test chạy against Postgres thật (Docker/local) — xem CLAUDE.md § Docker + apps/sync-worker/src/
// sync-catalog.test.ts cho pattern seed DB thật + cleanup theo externalRef.provider riêng của
// test file này (không giả định DB toàn cục rỗng).

const PROVIDER = "adaptive-interval-test-provider";
const ref = (id: string) => ({ provider: PROVIDER, id });

let seedCounter = 0;

async function seedMatch(status: "LIVE" | "HALFTIME" | "SCHEDULED" | "FINISHED", kickoffAt: Date) {
  const n = ++seedCounter;
  const competition = await prisma.competition.create({
    data: { name: "Adaptive Test League", type: "LEAGUE", countryCode: "VN", externalRef: ref(`comp-${n}`) as object },
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
    data: { name: "Home FC", externalRef: ref(`team-home-${n}`) as object },
  });
  const awayTeam = await prisma.team.create({
    data: { name: "Away FC", externalRef: ref(`team-away-${n}`) as object },
  });
  const match = await prisma.match.create({
    data: {
      competitionId: competition.id,
      seasonId: season.id,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      kickoffAt,
      status,
      homeScore: status === "SCHEDULED" ? null : 1,
      awayScore: status === "SCHEDULED" ? null : 0,
      externalRef: ref(`match-${n}`) as object,
    },
  });
  return match;
}

async function cleanupTestData() {
  await prisma.liveMatchState.deleteMany({ where: { match: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.match.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.season.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.competition.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
}

beforeEach(cleanupTestData);
afterAll(cleanupTestData);

describe("computeNextInterval", () => {
  it("có match LIVE -> tight", async () => {
    await seedMatch("LIVE", new Date("2020-01-01T00:00:00.000Z"));
    const interval = await computeNextInterval();
    expect(interval).toBe(15_000);
  });

  it("chỉ có match FINISHED -> idle", async () => {
    await seedMatch("FINISHED", new Date("2020-01-01T00:00:00.000Z"));
    const interval = await computeNextInterval();
    expect(interval).toBe(300_000);
  });

  it("SCHEDULED trong 10 phút tới (lookahead mặc định 15') -> tight", async () => {
    await seedMatch("SCHEDULED", new Date(Date.now() + 10 * 60_000));
    const interval = await computeNextInterval();
    expect(interval).toBe(15_000);
  });

  it("SCHEDULED xa 30 phút tới (ngoài lookahead mặc định 15') -> idle", async () => {
    await seedMatch("SCHEDULED", new Date(Date.now() + 30 * 60_000));
    const interval = await computeNextInterval();
    expect(interval).toBe(300_000);
  });

  it("không có match nào -> idle", async () => {
    const interval = await computeNextInterval();
    expect(interval).toBe(300_000);
  });

  it("nhận options tuỳ chỉnh (tightIntervalMs/idleIntervalMs/lookaheadMinutes)", async () => {
    await seedMatch("HALFTIME", new Date("2020-01-01T00:00:00.000Z"));
    const interval = await computeNextInterval({ tightIntervalMs: 5000, idleIntervalMs: 60_000 });
    expect(interval).toBe(5000);
  });
});
