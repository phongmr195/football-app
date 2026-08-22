import { prisma } from "@football-app/database";
import type { Prisma } from "@football-app/database";
import { runProcess, SYNC_WORKER_DIR, SYNC_WORKER_TSX_BIN } from "./process-runner";

// Full sync (teams/players/standings/matches/topScorers cho 1 competition+season) tốn ~26-40
// request qua rate limiter 8 req/phút của adapter (xem CLAUDE.md § Data provider) — ~5 phút
// worst-case. 15 phút để có đệm an toàn (generateMatchSummaryIfNeeded gọi LLM không await cho mỗi
// match FINISHED mới cũng có thể kéo dài thêm chút, xem sync-catalog.ts's syncMatches()).
const SYNC_TIMEOUT_MS = 15 * 60 * 1000;

function parseSyncSummary(stdout: string): Record<string, unknown> | undefined {
  const summaryLine = stdout.split("\n").find((line) => line.startsWith("SYNC_SUMMARY_JSON "));
  if (!summaryLine) return undefined;
  try {
    return JSON.parse(summaryLine.slice("SYNC_SUMMARY_JSON ".length));
  } catch {
    // Không throw — 1 dòng summary méo không nên làm cả run FAILED khi subprocess đã exit 0
    // (data thật đã sync xong), chỉ mất phần hiển thị resultSummary trên UI.
    return undefined;
  }
}

async function failRun(runId: string, message: string): Promise<void> {
  console.error(`runSyncPipeline(${runId}) failed:`, message);
  await prisma.syncRun.update({
    where: { id: runId },
    data: { status: "FAILED", errorMessage: message.slice(0, 2000), finishedAt: new Date() },
  });
}

// apps/api KHÔNG import code từ apps/sync-worker (2 app riêng) — chạy qua subprocess độc lập, cùng
// pattern runScraperPipeline() ở scraper-orchestrator.ts. Gọi KHÔNG await từ route handler.
export async function runSyncPipeline(runId: string): Promise<void> {
  const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });

  await prisma.syncRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date() } });

  const result = await runProcess(
    SYNC_WORKER_TSX_BIN,
    [
      "src/scripts/sync-competition-season.ts",
      "--competition-id",
      run.competitionId,
      "--season-id",
      run.seasonId,
    ],
    SYNC_WORKER_DIR,
    SYNC_TIMEOUT_MS,
  );

  if (result.code !== 0) {
    await failRun(runId, `sync-competition-season thất bại (exit ${result.code}): ${result.stderr.slice(-2000)}`);
    return;
  }

  const resultSummary = parseSyncSummary(result.stdout);
  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      status: "SUCCESS",
      resultSummary: (resultSummary ?? {}) as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
}
