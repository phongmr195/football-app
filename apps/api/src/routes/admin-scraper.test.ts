import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { signAdminToken } from "../middleware/admin-auth";
import { SCRAPER_COMPETITIONS } from "../scraper-competitions";

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

// Route resolve competition qua resolveCompetition() (admin-scraper.ts) — match theo
// externalRef.id ỔN ĐỊNH (xem scraper-competitions.ts's readExternalRefId/externalRefId, đổi từ
// match-theo-name sau bug thật 2026-08-20: admin rename Competition.name làm mất khớp), KHÔNG
// theo Competition.name. Test này PHẢI dùng ĐÚNG cùng khoá lookup (externalRef.id) — dùng lại
// name để tìm/tạo fixture (như bản cũ) sẽ tự stale y hệt bug gốc bất cứ khi nào không có data
// thật trong DB (CI, DB rỗng): tạo fallback row với externalRef.id KHÁC "2021" thật, route vẫn
// resolveCompetition() ra null -> 404, dù test tưởng đã setup đúng.
//
// Dùng ĐÚNG row có sẵn nếu DB đã sync thật (dev/local, externalRef.id="2021") — tránh tạo bản
// trùng gây vi phạm unique index (provider,id). Nếu chưa có (CI/DB rỗng), tự tạo 1 row MỚI với
// externalRef.id="2021" (khớp thật với SCRAPER_COMPETITIONS, không phải giá trị giả tuỳ ý) —
// track theo `id` (cuid) THẬT của row vừa tạo, không phải theo externalRef.id chung, để cleanup
// chỉ xoá đúng row TEST NÀY tự tạo, không bao giờ đụng tới row thật đã sync sẵn (dù trùng
// externalRef.id) khi row đó đã được TÌM THẤY thay vì tạo mới.
let fallbackCompetitionId: string | null = null;

async function getPremierLeagueSeason() {
  const externalRefId = SCRAPER_COMPETITIONS["premier-league"].externalRefId;
  let competition = await prisma.competition.findFirst({
    where: {
      AND: [
        { externalRef: { path: ["provider"], equals: "football-data" } },
        { externalRef: { path: ["id"], equals: externalRefId } },
      ],
    },
  });
  if (!competition) {
    competition = await prisma.competition.create({
      data: {
        name: "Premier League",
        type: "LEAGUE",
        externalRef: { provider: "football-data", id: externalRefId },
      },
    });
    fallbackCompetitionId = competition.id;
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
  // Chỉ xoá đúng row fallback do TEST NÀY tự tạo — track theo `id` (cuid) THẬT của chính row đó,
  // KHÔNG theo externalRef.id chung (nếu Premier League thật đã tồn tại từ trước, getPremierLeagueSeason()
  // sẽ TÌM THẤY nó thay vì tạo mới, fallbackCompetitionId vẫn null, và ta không được đụng tới row đó).
  if (fallbackCompetitionId) {
    await prisma.season.deleteMany({ where: { competitionId: fallbackCompetitionId } });
    await prisma.competition.deleteMany({ where: { id: fallbackCompetitionId } });
    fallbackCompetitionId = null;
  }
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
    // Phải đảm bảo Premier League tồn tại TRƯỚC — nếu không, route's resolveCompetition() trả
    // null trước khi kịp tới bước check season, thành 404 chứ không phải 400 (bug thật gặp ở CI:
    // DB rỗng, competitionKey="premier-league" không resolve được vì test này không tự tạo).
    await getPremierLeagueSeason();
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
    const body = (await res.json()) as { id: string; status: string; requestedLimit: number; dataTypes: string[] };
    expect(body.status).toBe("PENDING");
    expect(body.requestedLimit).toBe(30);
    // Không truyền dataTypes -> fallback DEFAULT_SCRAPER_DATA_TYPES (3 loại cũ), giữ đúng hành vi
    // trước piece "chọn loại data" cho client cũ/chưa cập nhật UI.
    expect(body.dataTypes).toEqual(["events", "lineups", "statistics"]);
    expect(runScraperPipeline).toHaveBeenCalledTimes(1);
    expect(runScraperPipeline).toHaveBeenCalledWith(body.id);
  });

  it("400 khi dataTypes chứa giá trị không hợp lệ", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);
    const { season } = await getPremierLeagueSeason();

    const res = await app.request("/admin/scraper-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        competitionKey: "premier-league",
        seasonId: season.id,
        limit: 20,
        dataTypes: ["shotmap", "not-a-real-type"],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("201 với dataTypes tuỳ chỉnh — lưu đúng giá trị đã chọn (chỉ shotmap+commentary)", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);
    const { season } = await getPremierLeagueSeason();

    const res = await app.request("/admin/scraper-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        competitionKey: "premier-league",
        seasonId: season.id,
        limit: 20,
        dataTypes: ["shotmap", "commentary"],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { dataTypes: string[] };
    expect(body.dataTypes).toEqual(["shotmap", "commentary"]);
  });

  it("201 với dataTypes chỉ chọn playerSeasonStats (loại season-level, không cần match-level nào)", async () => {
    const admin = await seedAdmin();
    const token = signAdminToken(admin.id);
    const { season } = await getPremierLeagueSeason();

    const res = await app.request("/admin/scraper-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        competitionKey: "premier-league",
        seasonId: season.id,
        limit: 20,
        dataTypes: ["playerSeasonStats"],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { dataTypes: string[] };
    expect(body.dataTypes).toEqual(["playerSeasonStats"]);
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
    const successRun = await prisma.scraperRun.create({
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

    // Lọc thêm theo competitionId — DB dev thật có thể đã có ScraperRun khác từ trước (chạy tay qua
    // UI thật, vd verify thật piece "chọn loại data" 2026-08-19 để lại row SUCCESS thật cho đúng
    // Premier League này) — KHÔNG assert `total === 1` tuyệt đối (bug thật gặp lại đúng lần verify
    // đó: total lên 2 vì có sẵn 1 SUCCESS run thật khác). Assert đúng: row vừa tạo CÓ trong kết quả
    // + MỌI row trả về đều đúng status filter — không cần giả định DB rỗng ngoài chính test này.
    const res = await app.request(`/admin/scraper-runs?status=SUCCESS&competitionId=${competition.id}&pageSize=50`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: { id: string; status: string }[]; total: number };
    expect(data.items.some((item) => item.id === successRun.id)).toBe(true);
    expect(data.items.every((item) => item.status === "SUCCESS")).toBe(true);
  });
});
