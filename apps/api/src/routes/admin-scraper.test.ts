import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { signAdminToken } from "../middleware/admin-auth";

// runScraperPipeline spawn 3 subprocess thật (pnpm/python) — mock hẳn module này để test route
// (validate/concurrency-guard) không chạy gì thật, đúng pattern sync-worker mock "./ai-provider".
vi.mock("../scraper-orchestrator", () => ({
  runScraperPipeline: vi.fn().mockResolvedValue(undefined),
}));

const PROVIDER = "admin-scraper-test-provider";
const ref = (id: string) => ({ provider: PROVIDER, id });
const ADMIN_USERNAME = "admin-scraper-test-admin";

async function seedAdmin() {
  return prisma.adminUser.create({ data: { username: ADMIN_USERNAME, passwordHash: "unused" } });
}

// Route resolve competition qua findFirst({name:"Premier League", provider:"football-data"}) —
// dùng ĐÚNG row đã có sẵn nếu DB đã sync thật (dev/local), tránh tạo bản trùng gây match không
// xác định. Nhưng KHÔNG thể giả định row này luôn tồn tại — CI chạy trên DB rỗng (không sync
// football-data thật), findFirstOrThrow từng fail ở CI dù pass ở local. Fallback: tự tạo 1 row
// nếu chưa có, đánh dấu bằng externalRef.id riêng (KHÔNG dùng PROVIDER chung — provider PHẢI là
// "football-data" để khớp đúng query của route) để cleanup xoá được đúng row này, không đụng data
// thật nếu nó tồn tại từ trước.
const PREMIER_LEAGUE_FALLBACK_ID = "admin-scraper-test-premier-league-fallback";

async function getPremierLeagueSeason() {
  let competition = await prisma.competition.findFirst({
    where: { name: "Premier League", externalRef: { path: ["provider"], equals: "football-data" } },
  });
  if (!competition) {
    competition = await prisma.competition.create({
      data: {
        name: "Premier League",
        type: "LEAGUE",
        externalRef: { provider: "football-data", id: PREMIER_LEAGUE_FALLBACK_ID },
      },
    });
  }
  let season = await prisma.season.findFirst({ where: { competitionId: competition.id } });
  if (!season) {
    season = await prisma.season.create({
      data: {
        competitionId: competition.id,
        name: "2025",
        startDate: new Date("2025-08-01"),
        endDate: new Date("2026-05-01"),
      },
    });
  }
  return { competition, season };
}

async function seedOtherCompetitionSeason() {
  const competition = await prisma.competition.create({
    data: { name: "Admin Scraper Test Other League", type: "LEAGUE", externalRef: ref("other-comp") as object },
  });
  const season = await prisma.season.create({
    data: { competitionId: competition.id, name: "2025", startDate: new Date("2025-08-01"), endDate: new Date("2026-05-01") },
  });
  return { competition, season };
}

async function cleanupTestData() {
  await prisma.scraperRun.deleteMany({ where: { createdByAdminUser: { username: ADMIN_USERNAME } } });
  await prisma.season.deleteMany({ where: { competition: { externalRef: { path: ["provider"], equals: PROVIDER } } } });
  await prisma.competition.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
  // Chỉ xoá đúng row fallback do TEST NÀY tự tạo (khớp chính xác externalRef.id) — không đụng
  // Premier League thật nếu DB đã có sync data thật (externalRef.id sẽ khác, vd "2021").
  await prisma.season.deleteMany({
    where: { competition: { externalRef: { path: ["id"], equals: PREMIER_LEAGUE_FALLBACK_ID } } },
  });
  await prisma.competition.deleteMany({ where: { externalRef: { path: ["id"], equals: PREMIER_LEAGUE_FALLBACK_ID } } });
  await prisma.adminUser.deleteMany({ where: { username: ADMIN_USERNAME } });
}

beforeEach(cleanupTestData);
// vi.mock ở trên tạo 1 mock duy nhất cho CẢ FILE — reset call count trước mỗi test để test khác
// (vd stale-run test) POST thành công (gọi runScraperPipeline thật) không làm sai lệch assertion
// toHaveBeenCalledTimes() của test khác.
beforeEach(() => {
  vi.clearAllMocks();
});
afterAll(cleanupTestData);

describe("POST /admin/scraper-runs", () => {
  it("401 khi chưa có bearer token", async () => {
    const res = await app.request("/admin/scraper-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ competitionKey: "premier-league", seasonId: "x", limit: 20 }),
    });
    expect(res.status).toBe(401);
  });

  it("400 khi competitionKey ngoài 5 giá trị cho phép", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);
    const res = await app.request("/admin/scraper-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ competitionKey: "champions-league", seasonId: "x", limit: 20 }),
    });
    expect(res.status).toBe(400);
  });

  it("400 khi limit < 10 hoặc > 100", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);
    const { season } = await getPremierLeagueSeason();

    const tooLow = await app.request("/admin/scraper-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ competitionKey: "premier-league", seasonId: season.id, limit: 5 }),
    });
    expect(tooLow.status).toBe(400);

    const tooHigh = await app.request("/admin/scraper-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ competitionKey: "premier-league", seasonId: season.id, limit: 200 }),
    });
    expect(tooHigh.status).toBe(400);
  });

  it("400 khi seasonId không thuộc competition đã chọn", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);
    const { season: otherSeason } = await seedOtherCompetitionSeason();

    const res = await app.request("/admin/scraper-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ competitionKey: "premier-league", seasonId: otherSeason.id, limit: 20 }),
    });
    expect(res.status).toBe(400);
  });

  it("409 khi đã có run PENDING/RUNNING", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);
    const { competition, season } = await getPremierLeagueSeason();
    await prisma.scraperRun.create({
      data: {
        competitionId: competition.id,
        seasonId: season.id,
        requestedLimit: 20,
        status: "RUNNING",
        createdByAdminUserId: admin.id,
      },
    });

    const res = await app.request("/admin/scraper-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ competitionKey: "premier-league", seasonId: season.id, limit: 20 }),
    });
    expect(res.status).toBe(409);
  });

  it("run RUNNING quá 45 phút tự đánh FAILED (stale) — KHÔNG còn chặn run mới bằng 409", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);
    const { competition, season } = await getPremierLeagueSeason();
    const staleRun = await prisma.scraperRun.create({
      data: {
        competitionId: competition.id,
        seasonId: season.id,
        requestedLimit: 20,
        status: "RUNNING",
        createdByAdminUserId: admin.id,
        createdAt: new Date(Date.now() - 46 * 60 * 1000), // 46 phút trước — quá ngưỡng 45 phút
      },
    });

    const res = await app.request("/admin/scraper-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ competitionKey: "premier-league", seasonId: season.id, limit: 20 }),
    });
    expect(res.status).toBe(201); // không còn 409 — stale run đã tự được đánh FAILED trước khi check

    const reconciled = await prisma.scraperRun.findUniqueOrThrow({ where: { id: staleRun.id } });
    expect(reconciled.status).toBe("FAILED");
    expect(reconciled.errorMessage).toContain("Quá thời gian chờ");
  });

  it("201 happy path — tạo ScraperRun PENDING, gọi runScraperPipeline đúng 1 lần, không chờ nó xong", async () => {
    const { runScraperPipeline } = await import("../scraper-orchestrator.js");
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);
    const { season } = await getPremierLeagueSeason();

    const res = await app.request("/admin/scraper-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ competitionKey: "premier-league", seasonId: season.id, limit: 30 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; requestedLimit: number };
    expect(body.status).toBe("PENDING");
    expect(body.requestedLimit).toBe(30);
    expect(runScraperPipeline).toHaveBeenCalledTimes(1);
    expect(runScraperPipeline).toHaveBeenCalledWith(body.id);
  });
});

describe("GET /admin/scraper-runs", () => {
  it("401 khi chưa có bearer token", async () => {
    const res = await app.request("/admin/scraper-runs");
    expect(res.status).toBe(401);
  });

  it("trả list đúng, lọc theo status", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);
    const { competition, season } = await getPremierLeagueSeason();
    await prisma.scraperRun.create({
      data: {
        competitionId: competition.id,
        seasonId: season.id,
        requestedLimit: 20,
        status: "SUCCESS",
        createdByAdminUserId: admin.id,
      },
    });
    await prisma.scraperRun.create({
      data: {
        competitionId: competition.id,
        seasonId: season.id,
        requestedLimit: 20,
        status: "FAILED",
        createdByAdminUserId: admin.id,
      },
    });

    // Lọc thêm theo competitionId — DB dev thật có thể đã có ScraperRun khác từ trước (chạy tay
    // qua UI thật), chỉ lọc status không đủ cô lập test này khỏi data đó.
    const res = await app.request(`/admin/scraper-runs?status=SUCCESS&competitionId=${competition.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: { status: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(data.items[0]?.status).toBe("SUCCESS");
  });
});
