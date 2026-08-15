import { prisma } from "@football-app/database";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";

// Test chạy against Postgres thật (Docker/local) — xem CLAUDE.md § Docker + apps/sync-worker/src/
// sync-catalog.test.ts cho pattern tương tự. app.request(path) là helper test của Hono, không cần
// spin lên HTTP server thật.

const PROVIDER = "matches-live-test-provider";
const ref = (id: string) => ({ provider: PROVIDER, id });

// Mỗi lần seed dùng externalRef id riêng (counter) — model có externalRef có unique index trên
// (provider, id) (xem CLAUDE.md § Database), nên nhiều match trong cùng 1 test/file phải khác id.
let seedCounter = 0;

async function seedMatch(status: "LIVE" | "HALFTIME" | "SCHEDULED" | "FINISHED" = "LIVE") {
  const n = ++seedCounter;
  const competition = await prisma.competition.create({
    data: { name: "Live Test League", type: "LEAGUE", countryCode: "VN", externalRef: ref(`comp-${n}`) as object },
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
      kickoffAt: new Date("2025-09-01T10:00:00.000Z"),
      status,
      homeScore: status === "SCHEDULED" ? null : 1,
      awayScore: status === "SCHEDULED" ? null : 0,
      externalRef: ref(`match-${n}`) as object,
    },
  });
  return match;
}

async function cleanupTestData() {
  await prisma.matchEvent.deleteMany({ where: { match: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.liveMatchState.deleteMany({ where: { match: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.match.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  await prisma.season.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.competition.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
}

beforeEach(async () => {
  await cleanupTestData();
  // REDIS_URL không set trong môi trường test (giống local dev không có Docker Redis chạy) —
  // đảm bảo mỗi test bắt đầu từ trạng thái sạch, không phụ thuộc thứ tự chạy giữa các file test.
  delete process.env.REDIS_URL;
});
afterAll(cleanupTestData);
afterEach(() => {
  delete process.env.REDIS_URL;
});

// DB local/CI dùng chung cho mọi test file + có thể có match LIVE thật (vd verify tay qua
// Prisma Studio, xem CLAUDE.md § Phần 6) — không được giả định "/matches/live" toàn cục rỗng
// hay chỉ có đúng số item test này seed. Luôn lọc theo externalRef.provider của riêng test này.
function onlyOurs<T extends { externalRef?: { provider?: string } | null }>(items: T[]): T[] {
  return items.filter((item) => item.externalRef?.provider === PROVIDER);
}

describe("GET /matches/live", () => {
  it("trả rỗng khi không có match nào đang LIVE/HALFTIME (của test này)", async () => {
    const res = await app.request("/matches/live");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ externalRef?: { provider?: string } | null }> };
    expect(onlyOurs(body.items)).toEqual([]);
  });

  it("trả match đang LIVE, không trả match SCHEDULED", async () => {
    const liveMatch = await seedMatch("LIVE");
    await seedMatch("SCHEDULED");

    const res = await app.request("/matches/live");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; externalRef?: { provider?: string } | null }>;
    };
    const ours = onlyOurs(body.items);
    expect(ours).toHaveLength(1);
    expect(ours[0]?.id).toBe(liveMatch.id);
  });

  it("Redis không được set (REDIS_URL unset) — route vẫn trả 200 thẳng từ Postgres, không 500", async () => {
    // Đây chính là property "graceful degradation" — REDIS_URL unset là trạng thái ambient thật
    // của local dev hiện tại (chưa chạy Docker Redis), xem CLAUDE.md § Tech stack.
    expect(process.env.REDIS_URL).toBeUndefined();
    await seedMatch("HALFTIME");

    const res = await app.request("/matches/live");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ externalRef?: { provider?: string } | null }> };
    expect(onlyOurs(body.items)).toHaveLength(1);
  });

  it("Redis được set nhưng KHÔNG kết nối được (unreachable) — route vẫn trả 200 từ Postgres", async () => {
    // Không có gì lắng nghe ở port 1 (reserved, không phải service nào) — mô phỏng Redis
    // down/unreachable một cách xác định (deterministic), không phụ thuộc trạng thái Docker của
    // máy chạy test. vi.resetModules() để "../lib/redis" (và "../app" import nó) đọc lại
    // process.env.REDIS_URL mới thay vì dùng client đã cache từ lần import trước.
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    vi.resetModules();
    const { app: freshApp } = await import("../app.js");

    await seedMatch("LIVE");

    const res = await freshApp.request("/matches/live");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ externalRef?: { provider?: string } | null }> };
    expect(onlyOurs(body.items)).toHaveLength(1); // vẫn đọc đúng từ Postgres dù cache ghi/đọc đều thất bại

    vi.resetModules();
  });
});

describe("GET /matches/:id/live", () => {
  it("404 khi match không tồn tại LiveMatchState", async () => {
    const match = await seedMatch("SCHEDULED");
    const res = await app.request(`/matches/${match.id}/live`);
    expect(res.status).toBe(404);
  });

  it("trả đúng snapshot LiveMatchState khi đã có", async () => {
    const match = await seedMatch("LIVE");
    await prisma.liveMatchState.create({
      data: { matchId: match.id, status: "LIVE", minute: 37, homeScore: 1, awayScore: 0 },
    });

    const res = await app.request(`/matches/${match.id}/live`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matchId: string; minute: number };
    expect(body.matchId).toBe(match.id);
    expect(body.minute).toBe(37);
  });
});

describe("GET /matches/:id/events", () => {
  it("trả rỗng khi chưa có event nào", async () => {
    const match = await seedMatch("LIVE");
    const res = await app.request(`/matches/${match.id}/events`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; lastSeq: number };
    expect(body.items).toEqual([]);
    expect(body.lastSeq).toBe(0);
  });

  it("catch-up đúng theo since_seq, order asc, trả lastSeq mới nhất", async () => {
    const match = await seedMatch("LIVE");
    await prisma.matchEvent.createMany({
      data: [
        { matchId: match.id, seq: 1, minute: 10, type: "YELLOW_CARD" },
        { matchId: match.id, seq: 2, minute: 23, type: "GOAL" },
        { matchId: match.id, seq: 3, minute: 45, type: "GOAL" },
      ],
    });

    const first = await app.request(`/matches/${match.id}/events?since_seq=0`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { items: Array<{ seq: number }>; lastSeq: number };
    expect(firstBody.items.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(firstBody.lastSeq).toBe(3);

    const second = await app.request(`/matches/${match.id}/events?since_seq=${firstBody.lastSeq}`);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { items: unknown[]; lastSeq: number };
    expect(secondBody.items).toEqual([]); // catch-up từ lastSeq trước -> không còn event mới
    expect(secondBody.lastSeq).toBe(3); // giữ nguyên since_seq khi không có event mới
  });
});
