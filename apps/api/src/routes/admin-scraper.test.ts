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

// Dùng ĐÚNG Premier League (provider football-data) đã có sẵn trong DB dev thật, KHÔNG tạo bản
// trùng — route resolve competition qua findFirst({name, provider}), tạo thêm 1 row "Premier
// League" nữa sẽ match không xác định (2 row cùng name+provider), làm test flaky theo thứ tự insert.
async function getRealPremierLeagueSeason() {
  const competition = await prisma.competition.findFirstOrThrow({
    where: { name: "Premier League", externalRef: { path: ["provider"], equals: "football-data" } },
  });
  const season = await prisma.season.findFirstOrThrow({ where: { competitionId: competition.id } });
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
    const { season } = await getRealPremierLeagueSeason();

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
    const { competition, season } = await getRealPremierLeagueSeason();
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
    const { competition, season } = await getRealPremierLeagueSeason();
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
    const { season } = await getRealPremierLeagueSeason();

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
    const { competition, season } = await getRealPremierLeagueSeason();
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
