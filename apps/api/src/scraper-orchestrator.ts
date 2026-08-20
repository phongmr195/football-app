import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@football-app/database";
import type { Prisma } from "@football-app/database";
import {
  readExternalRefId,
  SCRAPER_COMPETITIONS,
  toSofascoreSeasonString,
  type ScraperCompetitionKey,
} from "./scraper-competitions";

// apps/api luôn chạy với cwd = apps/api (dev qua tsx watch, prod qua node dist/index.js — cả 2 đều
// invoke từ trong thư mục này, xem package.json's "dev"/"start" script) — an toàn để resolve theo
// process.cwd() thay vì cần import.meta.url/__dirname (không có precedent nào trong repo).
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const SYNC_WORKER_DIR = path.resolve(REPO_ROOT, "apps/sync-worker");
const SCRAPER_DIR = path.resolve(REPO_ROOT, "apps/scraper-sofascore");
const SCRAPER_VENV_PYTHON = path.resolve(SCRAPER_DIR, ".venv/bin/python");
// Gọi thẳng tsx's binary (script shell dùng `exec` thay tiến trình, KHÔNG fork con) thay vì
// `pnpm --filter @football-app/sync-worker <script>` — verify thật 2026-08-19: dù đã đổi "close"
// sang "exit" (xem comment ở runProcess), bước generate-manifest/ingest-sofascore CHẠY QUA PNPM
// vẫn tiếp tục kẹt RUNNING vĩnh viễn dù script con đã chạy xong + ghi DB thành công thật (verify
// lại: MatchEvent đã có data nhưng ScraperRun không bao giờ chuyển SUCCESS). pnpm tự thân là 1
// chương trình Node đầy đủ, tự quản lý vòng đời tiến trình con + có thể trì hoãn tự thoát (update
// notifier/telemetry) theo cách không kiểm soát được từ bên ngoài — bỏ hẳn pnpm khỏi chain, spawn
// tsx trực tiếp để chỉ còn 1 lớp tiến trình (thay vì apps/api -> pnpm -> tsx).
const SYNC_WORKER_TSX_BIN = path.resolve(SYNC_WORKER_DIR, "node_modules/.bin/tsx");

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// spawn() (KHÔNG exec — array args, tránh shell injection dù input đã validate ở route). Bắt buộc
// có "error" listener — ChildProcess's "error" event (vd ENOENT nếu command không tồn tại) sẽ crash
// cả tiến trình apps/api nếu không nghe, giống nguyên tắc goal-notifier.ts đã áp dụng cho ioredis.
function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);

    function finish(result: ProcessResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      finish({ code: null, stdout, stderr: stderr + `\nspawn error: ${err.message}` });
    });
    // "exit" (KHÔNG "close") — verify thật 2026-08-18: chạy qua `pnpm --filter ...` (spawn thêm
    // tiến trình node/tsx con), "close" (đợi TOÀN BỘ stdio fd đóng, kể cả fd thừa hưởng bởi tiến
    // trình con của tiến trình con) KHÔNG BAO GIỜ fire dù script đã chạy xong + ghi DB thành công
    // thật (verify: MatchEvent đã có data), khiến ScraperRun kẹt RUNNING vĩnh viễn. "exit" chỉ cần
    // tiến trình chính tự thoát (đủ để biết bước đã xong), không phụ thuộc fd của tiến trình cháu.
    child.on("exit", (code) => {
      finish({ code, stdout, stderr });
    });
  });
}

async function failRun(runId: string, message: string): Promise<void> {
  console.error(`runScraperPipeline(${runId}) failed:`, message);
  await prisma.scraperRun.update({
    where: { id: runId },
    data: { status: "FAILED", errorMessage: message.slice(0, 2000), finishedAt: new Date() },
  });
}

interface PipelineOutcome {
  success: boolean;
  errorMessage?: string;
  ingestSummary?: Record<string, unknown>;
}

function parseIngestSummary(stdout: string): Record<string, unknown> | undefined {
  const summaryLine = stdout.split("\n").find((line) => line.startsWith("INGEST_SUMMARY_JSON "));
  return summaryLine ? JSON.parse(summaryLine.slice("INGEST_SUMMARY_JSON ".length)) : undefined;
}

// 3 bước pipeline theo TỪNG MATCH (generate manifest -> scraper.py -> ingest), đúng hệt cách chạy
// tay hiện tại (xem apps/scraper-sofascore/README.md) — tách khỏi runScraperPipeline() để chạy
// song song/độc lập với runPlayerSeasonStatsPipeline() (loại data season-level, xem
// SCRAPER_DATA_TYPES's playerSeasonStats). KHÔNG gọi failRun() trực tiếp — trả kết quả, để
// runScraperPipeline() quyết định status cuối cùng SAU KHI cả 2 pipeline (nếu có) đều xong.
async function runMatchLevelPipeline(
  runId: string,
  run: { requestedLimit: number; competitionId: string; seasonId: string },
  matchLevelTypes: string[],
  sofascoreKey: string,
  sofascoreSeason: string,
): Promise<PipelineOutcome> {
  const manifestPath = path.resolve(SCRAPER_DIR, "manifests", `${runId}.json`);
  const outputDir = path.resolve(SCRAPER_DIR, "output", runId);
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  const dataTypesArg = matchLevelTypes.join(",");
  const step1 = await runProcess(
    SYNC_WORKER_TSX_BIN,
    [
      "src/scripts/generate-sofascore-manifest.ts",
      "--limit",
      String(run.requestedLimit),
      "--out",
      manifestPath,
      "--competition-id",
      run.competitionId,
      "--season-id",
      run.seasonId,
      "--sofascore-key",
      sofascoreKey,
      "--sofascore-season",
      sofascoreSeason,
      "--data-types",
      dataTypesArg,
    ],
    SYNC_WORKER_DIR,
    5 * 60 * 1000,
  );
  if (step1.code !== 0) {
    return { success: false, errorMessage: `generate-sofascore-manifest thất bại (exit ${step1.code}): ${step1.stderr.slice(-2000)}` };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { matches: unknown[] };
  const matchesFound = manifest.matches.length;
  await prisma.scraperRun.update({ where: { id: runId }, data: { matchesFound } });

  if (matchesFound === 0) {
    return { success: false, errorMessage: "Không còn trận nào cần scrape cho giải/mùa này." };
  }

  // Timeout an toàn theo limit × số loại data được chọn (mỗi loại data = 1 request/trận thêm,
  // REQUEST_DELAY_SECONDS=3s/request + xử lý network), cộng đệm 5 phút — tự kill nếu treo, tránh
  // leak tiến trình vô thời hạn.
  const step2TimeoutMs = run.requestedLimit * matchLevelTypes.length * 5 * 1000 + 5 * 60 * 1000;
  const step2 = await runProcess(
    SCRAPER_VENV_PYTHON,
    ["scraper.py", manifestPath, outputDir, "--data-types", dataTypesArg],
    SCRAPER_DIR,
    step2TimeoutMs,
  );
  const matchesScraped = existsSync(outputDir) ? readdirSync(outputDir).length : 0;
  await prisma.scraperRun.update({ where: { id: runId }, data: { matchesScraped } });

  const scraperBlockedMidBatch = step2.code !== 0;

  if (matchesScraped === 0) {
    return { success: false, errorMessage: `scraper.py không scrape được trận nào (exit ${step2.code}): ${step2.stderr.slice(-2000)}` };
  }

  // Ingest phần đã scrape được, DÙ bước trên bị chặn giữa batch (không phí dữ liệu thật đã lấy
  // được, đúng convention pipeline thủ công — xem CLAUDE.md § Scraper).
  const step3 = await runProcess(
    SYNC_WORKER_TSX_BIN,
    ["src/scripts/ingest-sofascore.ts", outputDir],
    SYNC_WORKER_DIR,
    5 * 60 * 1000,
  );
  if (step3.code !== 0) {
    return { success: false, errorMessage: `ingest-sofascore thất bại (exit ${step3.code}): ${step3.stderr.slice(-2000)}` };
  }

  return {
    success: !scraperBlockedMidBatch,
    errorMessage: scraperBlockedMidBatch
      ? `Bị chặn giữa batch sau ${matchesScraped}/${matchesFound} trận — đã ingest phần dữ liệu scrape được.`
      : undefined,
    ingestSummary: parseIngestSummary(step3.stdout),
  };
}

// 3 bước pipeline SEASON-level (2026-08-20) — KHÁC hẳn runMatchLevelPipeline(): 1 lần fetch DUY
// NHẤT cho cả competition/season (không theo từng match, không có "limit"), xem
// apps/scraper-sofascore/scrape-player-season-stats.py. Luôn re-run toàn bộ khi được chọn (không
// cần gate "đã scrape chưa" — chỉ 1 request/run, không tốn quota đáng kể để lo giới hạn).
async function runPlayerSeasonStatsPipeline(
  runId: string,
  run: { competitionId: string; seasonId: string },
  sofascoreKey: string,
  sofascoreSeason: string,
): Promise<PipelineOutcome> {
  const manifestPath = path.resolve(SCRAPER_DIR, "manifests", `${runId}-player-season-stats.json`);
  const outputPath = path.resolve(SCRAPER_DIR, "output", runId, "player-season-stats.json");
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const step1 = await runProcess(
    SYNC_WORKER_TSX_BIN,
    [
      "src/scripts/generate-player-season-stats-manifest.ts",
      "--competition-id",
      run.competitionId,
      "--season-id",
      run.seasonId,
      "--sofascore-key",
      sofascoreKey,
      "--sofascore-season",
      sofascoreSeason,
      "--out",
      manifestPath,
    ],
    SYNC_WORKER_DIR,
    5 * 60 * 1000,
  );
  if (step1.code !== 0) {
    return {
      success: false,
      errorMessage: `generate-player-season-stats-manifest thất bại (exit ${step1.code}): ${step1.stderr.slice(-2000)}`,
    };
  }

  const step2 = await runProcess(
    SCRAPER_VENV_PYTHON,
    ["scrape-player-season-stats.py", manifestPath, outputPath],
    SCRAPER_DIR,
    10 * 60 * 1000,
  );
  if (step2.code !== 0 || !existsSync(outputPath)) {
    return { success: false, errorMessage: `scrape-player-season-stats.py thất bại (exit ${step2.code}): ${step2.stderr.slice(-2000)}` };
  }

  const step3 = await runProcess(
    SYNC_WORKER_TSX_BIN,
    ["src/scripts/ingest-player-season-stats.ts", outputPath],
    SYNC_WORKER_DIR,
    5 * 60 * 1000,
  );
  if (step3.code !== 0) {
    return { success: false, errorMessage: `ingest-player-season-stats thất bại (exit ${step3.code}): ${step3.stderr.slice(-2000)}` };
  }

  return { success: true, ingestSummary: parseIngestSummary(step3.stdout) };
}

// apps/api KHÔNG import code từ apps/sync-worker (2 app riêng, không phải package chung) — mọi
// bước chạy qua subprocess độc lập. Gọi KHÔNG await từ route handler (`void
// runScraperPipeline(...).catch()`), giống pattern ai_match_summary — không block response.
export async function runScraperPipeline(runId: string): Promise<void> {
  const run = await prisma.scraperRun.findUniqueOrThrow({
    where: { id: runId },
    include: { competition: true, season: true },
  });

  await prisma.scraperRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date() } });

  // Match theo externalRef.id (ổn định) — KHÔNG theo Competition.name (admin sửa được qua CRUD,
  // xem comment ở scraper-competitions.ts).
  const competitionExternalRefId = readExternalRefId(run.competition.externalRef);
  const competitionKey = (Object.keys(SCRAPER_COMPETITIONS) as ScraperCompetitionKey[]).find(
    (key) => SCRAPER_COMPETITIONS[key].externalRefId === competitionExternalRefId,
  );
  if (!competitionKey) {
    await failRun(runId, `Không tìm thấy sofascoreKey cho giải "${run.competition.name}"`);
    return;
  }
  const sofascoreKey = SCRAPER_COMPETITIONS[competitionKey].sofascoreKey;
  const sofascoreSeason = toSofascoreSeasonString(run.season.name);

  // "playerSeasonStats" (season-level) tách riêng khỏi 9 loại match-level còn lại — không đi qua
  // generate-sofascore-manifest.ts/scraper.py (khác shape hoàn toàn, xem SCRAPER_DATA_TYPES).
  const matchLevelTypes = run.dataTypes.filter((t) => t !== "playerSeasonStats");
  const wantsPlayerSeasonStats = run.dataTypes.includes("playerSeasonStats");

  const combinedIngestSummary: Record<string, unknown> = {};
  const errorMessages: string[] = [];
  let anyFailure = false;

  // try/catch quanh MỖI pipeline (KHÔNG để throw thoát thẳng ra ngoài) — bug thật đã gặp
  // (2026-08-20): parseIngestSummary() throw SyntaxError (JSON bị cắt cụt do process.exit() trong
  // script con, xem fix ở apps/sync-worker/src/scripts/*.ts) khiến runPlayerSeasonStatsPipeline()
  // reject, cả runScraperPipeline() reject theo, ScraperRun kẹt RUNNING vĩnh viễn (update cuối cùng
  // ở dưới không bao giờ chạy tới). Dù bug gốc (process.exit cắt cụt stdout) đã fix, giữ lớp bảo vệ
  // này để BẤT KỲ lỗi bất ngờ nào khác từ 2 pipeline cũng luôn kết thúc bằng 1 status cuối cùng
  // (FAILED, có errorMessage rõ ràng) thay vì để ScraperRun kẹt RUNNING không rõ lý do.
  if (matchLevelTypes.length > 0) {
    try {
      const result = await runMatchLevelPipeline(runId, run, matchLevelTypes, sofascoreKey, sofascoreSeason);
      if (result.ingestSummary) Object.assign(combinedIngestSummary, result.ingestSummary);
      if (!result.success) {
        anyFailure = true;
        if (result.errorMessage) errorMessages.push(result.errorMessage);
      }
    } catch (err) {
      anyFailure = true;
      errorMessages.push(`runMatchLevelPipeline throw bất ngờ: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (wantsPlayerSeasonStats) {
    try {
      const result = await runPlayerSeasonStatsPipeline(runId, run, sofascoreKey, sofascoreSeason);
      if (result.ingestSummary) Object.assign(combinedIngestSummary, result.ingestSummary);
      if (!result.success) {
        anyFailure = true;
        if (result.errorMessage) errorMessages.push(result.errorMessage);
      }
    } catch (err) {
      anyFailure = true;
      errorMessages.push(
        `runPlayerSeasonStatsPipeline throw bất ngờ: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await prisma.scraperRun.update({
    where: { id: runId },
    data: {
      status: anyFailure ? "FAILED" : "SUCCESS",
      errorMessage: errorMessages.length > 0 ? errorMessages.join(" | ").slice(0, 2000) : null,
      ingestSummary: combinedIngestSummary as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
}
