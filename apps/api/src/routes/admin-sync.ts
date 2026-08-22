import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";
import { SYNC_COMPETITION_KEYS, SYNC_COMPETITIONS, type SyncCompetitionKey } from "../sync-competitions";
import { runSyncPipeline } from "../sync-orchestrator";

const createRunBodySchema = z.object({
  competitionKey: z.enum(SYNC_COMPETITION_KEYS as [SyncCompetitionKey, ...SyncCompetitionKey[]]),
  seasonId: z.string().min(1),
});

const listRunsQuerySchema = paginationQuerySchema.extend({
  competitionId: z.string().optional(),
  status: z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED"]).optional(),
});

// Match theo externalRef.id (ổn định) — KHÔNG theo Competition.name (admin sửa được qua CRUD),
// cùng lý do resolveCompetition() ở admin-scraper.ts.
async function resolveCompetition(competitionKey: SyncCompetitionKey) {
  const config = SYNC_COMPETITIONS[competitionKey];
  return prisma.competition.findFirst({
    where: {
      AND: [
        { externalRef: { path: ["provider"], equals: "football-data" } },
        { externalRef: { path: ["id"], equals: config.externalRefId } },
      ],
    },
  });
}

// Cùng safety net "tự đánh FAILED nếu kẹt quá lâu" như admin-scraper.ts's reconcileStaleRuns() —
// root cause chưa xác định chắc chắn (nghi ngờ child_process "exit" không luôn được deliver), xem
// comment đầy đủ ở admin-scraper.ts. Ngưỡng 30 phút (thấp hơn scraper's 45 phút — sync 1 giải/mùa
// không có bước Python/limit lớn như scraper, worst-case thật ~5 phút, xem sync-orchestrator.ts's
// SYNC_TIMEOUT_MS).
const STALE_RUN_THRESHOLD_MS = 30 * 60 * 1000;

async function reconcileStaleRuns(): Promise<void> {
  await prisma.syncRun.updateMany({
    where: { status: { in: ["PENDING", "RUNNING"] }, createdAt: { lt: new Date(Date.now() - STALE_RUN_THRESHOLD_MS) } },
    data: {
      status: "FAILED",
      errorMessage: "Quá thời gian chờ (>30 phút) — kiểm tra dữ liệu đã sync thực tế trong DB nếu cần xác nhận.",
      finishedAt: new Date(),
    },
  });
}

export const adminSyncRoute = new Hono()
  // Cầu nối competitionKey (client chỉ biết key+label, không biết Competition.id thật trong DB) ->
  // competitionId + danh sách mùa giải thật — cùng pattern GET /admin/scraper-competitions.
  .get("/admin/sync-competitions", requireAdminSession, async (c) => {
    const results = await Promise.all(
      SYNC_COMPETITION_KEYS.map(async (key) => {
        const competition = await resolveCompetition(key);
        if (!competition) return { key, label: SYNC_COMPETITIONS[key].label, competitionId: null, seasons: [] };
        const seasons = await prisma.season.findMany({
          where: { competitionId: competition.id },
          orderBy: { startDate: "desc" },
          select: { id: true, name: true, isCurrent: true },
        });
        return { key, label: SYNC_COMPETITIONS[key].label, competitionId: competition.id, seasons };
      }),
    );
    return c.json({ items: results });
  })
  .post("/admin/sync-runs", requireAdminSession, zValidator("json", createRunBodySchema), async (c) => {
    const { competitionKey, seasonId } = c.req.valid("json");
    const adminUserId = c.get("adminUserId");

    const competition = await resolveCompetition(competitionKey);
    if (!competition) return c.json({ error: "competition not found" }, 404);
    const competitionId = competition.id;

    const season = await prisma.season.findUnique({ where: { id: seasonId } });
    if (!season || season.competitionId !== competitionId) {
      return c.json({ error: "season does not belong to the selected competition" }, 400);
    }

    await reconcileStaleRuns();
    const activeRun = await prisma.syncRun.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] } } });
    if (activeRun) {
      return c.json({ error: "a sync run is already in progress", runId: activeRun.id }, 409);
    }

    const run = await prisma.syncRun.create({
      data: { competitionId, seasonId, createdByAdminUserId: adminUserId },
    });

    // Không await — job chạy vài phút, không block response. Lỗi bất ngờ (throw trước khi kịp tự
    // ghi FAILED bên trong runSyncPipeline) vẫn được bắt ở đây, đúng nguyên tắc goal-notifier.ts.
    void runSyncPipeline(run.id).catch((err) => {
      console.error(`runSyncPipeline(${run.id}) threw unexpectedly:`, err);
      void prisma.syncRun.update({
        where: { id: run.id },
        data: { status: "FAILED", errorMessage: String(err).slice(0, 2000), finishedAt: new Date() },
      });
    });

    return c.json(run, 201);
  })
  .get("/admin/sync-runs", requireAdminSession, zValidator("query", listRunsQuerySchema), async (c) => {
    await reconcileStaleRuns();
    const { page, pageSize, competitionId, status } = c.req.valid("query");
    const where = {
      ...(competitionId ? { competitionId } : {}),
      ...(status ? { status } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.syncRun.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: { competition: { select: { id: true, name: true } }, season: { select: { id: true, name: true } } },
      }),
      prisma.syncRun.count({ where }),
    ]);
    return c.json({ items, page, pageSize, total });
  })
  .get("/admin/sync-runs/:id", requireAdminSession, zValidator("param", z.object({ id: z.string() })), async (c) => {
    await reconcileStaleRuns();
    const { id } = c.req.valid("param");
    const run = await prisma.syncRun.findUnique({
      where: { id },
      include: { competition: { select: { id: true, name: true } }, season: { select: { id: true, name: true } } },
    });
    if (!run) return c.json({ error: "not found" }, 404);
    return c.json(run);
  });
