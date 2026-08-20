import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";
import {
  DEFAULT_SCRAPER_DATA_TYPES,
  SCRAPER_COMPETITION_KEYS,
  SCRAPER_COMPETITIONS,
  SCRAPER_DATA_TYPE_KEYS,
  type ScraperCompetitionKey,
  type ScraperDataType,
} from "../scraper-competitions";
import { runScraperPipeline } from "../scraper-orchestrator";

const createRunBodySchema = z.object({
  competitionKey: z.enum(SCRAPER_COMPETITION_KEYS as [ScraperCompetitionKey, ...ScraperCompetitionKey[]]),
  seasonId: z.string(),
  limit: z.number().int().min(10).max(100),
  // Optional — client cũ (chưa có checkbox chọn loại data) không gửi field này, fallback về 3 loại
  // cũ (đúng default ở schema.prisma's ScraperRun.dataTypes).
  dataTypes: z
    .array(z.enum(SCRAPER_DATA_TYPE_KEYS as [ScraperDataType, ...ScraperDataType[]]))
    .min(1)
    .optional(),
});

const listRunsQuerySchema = paginationQuerySchema.extend({
  competitionId: z.string().optional(),
  status: z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED"]).optional(),
});

async function resolveCompetition(competitionKey: ScraperCompetitionKey) {
  const config = SCRAPER_COMPETITIONS[competitionKey];
  // Match theo externalRef.id (ổn định) — KHÔNG theo Competition.name (admin sửa được qua CRUD,
  // xem comment ở scraper-competitions.ts). Luôn filter cả provider VÀ id (nguyên tắc externalRef
  // lookup ở CLAUDE.md § Database).
  return prisma.competition.findFirst({
    where: {
      AND: [
        { externalRef: { path: ["provider"], equals: "football-data" } },
        { externalRef: { path: ["id"], equals: config.externalRefId } },
      ],
    },
  });
}

// Safety net — verify thật 2026-08-19: ScraperRun có thể kẹt vĩnh viễn ở PENDING/RUNNING (root
// cause chưa xác định chắc chắn — nghi ngờ child_process "exit" không luôn được deliver khi
// spawn xảy ra trong 1 tiến trình Node sống lâu, nhưng chưa reproduce được trong môi trường tách
// biệt). KHÔNG để 1 run kẹt chặn mọi run sau vĩnh viễn (409 "already in progress" mãi mãi) — tự
// đánh FAILED nếu quá 45 phút (đủ dư so với worst-case hợp lệ: limit=100 → step1 5p + step2 tối đa
// 30p + step3 5p = 40p). Gọi ở MỌI endpoint (không chỉ POST) để UI tự phản ánh đúng dù admin chỉ
// mở trang xem, không bấm Áp dụng.
const STALE_RUN_THRESHOLD_MS = 45 * 60 * 1000;

async function reconcileStaleRuns(): Promise<void> {
  await prisma.scraperRun.updateMany({
    where: { status: { in: ["PENDING", "RUNNING"] }, createdAt: { lt: new Date(Date.now() - STALE_RUN_THRESHOLD_MS) } },
    data: {
      status: "FAILED",
      errorMessage:
        "Quá thời gian chờ (>45 phút) — orchestrator có thể đã bị kẹt sau khi process con đã thoát. " +
        "Kiểm tra dữ liệu đã ghi thực tế trong DB (MatchEvent/MatchLineup) nếu cần xác nhận đã scrape " +
        "được gì trước khi kẹt.",
      finishedAt: new Date(),
    },
  });
}

export const adminScraperRoute = new Hono()
  // Cầu nối competitionKey (client chỉ biết key+label, không biết Competition.id thật trong DB) ->
  // competitionId + danh sách mùa giải thật, để trang admin không cần tự tra cứu/duplicate mapping
  // ở phía client. resolveCompetition() match theo externalRef.id (ổn định), không theo
  // Competition.name (admin sửa được qua CRUD /admin/competitions — tên hiển thị có thể đổi bất kỳ
  // lúc nào, xem comment ở scraper-competitions.ts).
  .get("/admin/scraper-competitions", requireAdminSession, async (c) => {
    const results = await Promise.all(
      SCRAPER_COMPETITION_KEYS.map(async (key) => {
        const competition = await resolveCompetition(key);
        if (!competition) return { key, label: SCRAPER_COMPETITIONS[key].label, competitionId: null, seasons: [] };
        const seasons = await prisma.season.findMany({
          where: { competitionId: competition.id },
          orderBy: { startDate: "desc" },
          select: { id: true, name: true, isCurrent: true },
        });
        return { key, label: SCRAPER_COMPETITIONS[key].label, competitionId: competition.id, seasons };
      }),
    );
    return c.json({ items: results });
  })
  .post("/admin/scraper-runs", requireAdminSession, zValidator("json", createRunBodySchema), async (c) => {
    const { competitionKey, seasonId, limit, dataTypes } = c.req.valid("json");
    const adminUserId = c.get("adminUserId");

    const competition = await resolveCompetition(competitionKey);
    if (!competition) return c.json({ error: "competition not found" }, 404);

    const season = await prisma.season.findUnique({ where: { id: seasonId } });
    if (!season || season.competitionId !== competition.id) {
      return c.json({ error: "season does not belong to the selected competition" }, 400);
    }

    await reconcileStaleRuns();
    const activeRun = await prisma.scraperRun.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] } } });
    if (activeRun) {
      return c.json({ error: "a scraper run is already in progress", runId: activeRun.id }, 409);
    }

    const run = await prisma.scraperRun.create({
      data: {
        competitionId: competition.id,
        seasonId: season.id,
        requestedLimit: limit,
        dataTypes: dataTypes ?? DEFAULT_SCRAPER_DATA_TYPES,
        createdByAdminUserId: adminUserId,
      },
    });

    // Không await — job chạy nhiều phút, không block response. Lỗi bất ngờ (vd throw trước khi kịp
    // tự ghi FAILED bên trong runScraperPipeline) vẫn được bắt ở đây để không làm crash apps/api,
    // đúng nguyên tắc goal-notifier.ts.
    void runScraperPipeline(run.id).catch((err) => {
      console.error(`runScraperPipeline(${run.id}) threw unexpectedly:`, err);
      void prisma.scraperRun.update({
        where: { id: run.id },
        data: { status: "FAILED", errorMessage: String(err).slice(0, 2000), finishedAt: new Date() },
      });
    });

    return c.json(run, 201);
  })
  .get("/admin/scraper-runs", requireAdminSession, zValidator("query", listRunsQuerySchema), async (c) => {
    await reconcileStaleRuns();
    const { page, pageSize, competitionId, status } = c.req.valid("query");
    const where = {
      ...(competitionId ? { competitionId } : {}),
      ...(status ? { status } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.scraperRun.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: { competition: { select: { id: true, name: true } }, season: { select: { id: true, name: true } } },
      }),
      prisma.scraperRun.count({ where }),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  .get("/admin/scraper-runs/:id", requireAdminSession, zValidator("param", z.object({ id: z.string() })), async (c) => {
    await reconcileStaleRuns();
    const { id } = c.req.valid("param");
    const run = await prisma.scraperRun.findUnique({
      where: { id },
      include: { competition: { select: { id: true, name: true } }, season: { select: { id: true, name: true } } },
    });
    if (!run) return c.json({ error: "not found" }, 404);
    return c.json(run);
  });
