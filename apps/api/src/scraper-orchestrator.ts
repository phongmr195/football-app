import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@football-app/database";
import { SCRAPER_COMPETITIONS, toSofascoreSeasonString, type ScraperCompetitionKey } from "./scraper-competitions";

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

// Chạy 3 bước pipeline (generate manifest -> scraper.py -> ingest) như subprocess độc lập, đúng hệt
// cách chạy tay hiện tại (xem apps/scraper-sofascore/README.md) — apps/api KHÔNG import code từ
// apps/sync-worker (2 app riêng, không phải package chung). Gọi KHÔNG await từ route handler (`void
// runScraperPipeline(...).catch()`), giống pattern ai_match_summary — không block response.
export async function runScraperPipeline(runId: string): Promise<void> {
  const run = await prisma.scraperRun.findUniqueOrThrow({
    where: { id: runId },
    include: { competition: true, season: true },
  });

  await prisma.scraperRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date() } });

  const competitionKey = (Object.keys(SCRAPER_COMPETITIONS) as ScraperCompetitionKey[]).find(
    (key) => SCRAPER_COMPETITIONS[key].dbName === run.competition.name,
  );
  if (!competitionKey) {
    await failRun(runId, `Không tìm thấy sofascoreKey cho giải "${run.competition.name}"`);
    return;
  }
  const sofascoreKey = SCRAPER_COMPETITIONS[competitionKey].sofascoreKey;
  const sofascoreSeason = toSofascoreSeasonString(run.season.name);

  // Path riêng biệt mỗi run — tránh đụng manifest.json/output/ dùng chung của CLI thủ công, và giữ
  // artifact từng run độc lập để debug (xem plan piece này).
  const manifestPath = path.resolve(SCRAPER_DIR, "manifests", `${runId}.json`);
  const outputDir = path.resolve(SCRAPER_DIR, "output", runId);
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  // Bước 1 — generate manifest, gọi thẳng tsx (KHÔNG qua pnpm --filter, xem comment ở
  // SYNC_WORKER_TSX_BIN), cwd = apps/sync-worker để khớp đúng đường dẫn script tương đối.
  const dataTypesArg = run.dataTypes.join(",");
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
    await failRun(runId, `generate-sofascore-manifest thất bại (exit ${step1.code}): ${step1.stderr.slice(-2000)}`);
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { matches: unknown[] };
  const matchesFound = manifest.matches.length;
  await prisma.scraperRun.update({ where: { id: runId }, data: { matchesFound } });

  if (matchesFound === 0) {
    await failRun(runId, "Không còn trận nào cần scrape cho giải/mùa này.");
    return;
  }

  // Bước 2 — scraper.py qua venv Python. Timeout an toàn theo limit × số loại data được chọn (mỗi
  // loại data = 1 request/trận thêm, REQUEST_DELAY_SECONDS=3s/request + xử lý network), cộng đệm 5
  // phút — tự kill nếu treo, tránh leak tiến trình vô thời hạn. `run.dataTypes.length` thay hằng số
  // cố định cũ (trước đây luôn đúng 3 loại nên "limit * 15s" == "limit * 3 loại * 5s").
  const step2TimeoutMs = run.requestedLimit * run.dataTypes.length * 5 * 1000 + 5 * 60 * 1000;
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
    await failRun(runId, `scraper.py không scrape được trận nào (exit ${step2.code}): ${step2.stderr.slice(-2000)}`);
    return;
  }

  // Bước 3 — ingest phần đã scrape được, DÙ bước 2 bị chặn giữa batch (không phí dữ liệu thật đã
  // lấy được, đúng convention pipeline thủ công hiện tại — xem CLAUDE.md § Scraper). Gọi thẳng tsx,
  // cùng lý do bước 1.
  const step3 = await runProcess(
    SYNC_WORKER_TSX_BIN,
    ["src/scripts/ingest-sofascore.ts", outputDir],
    SYNC_WORKER_DIR,
    5 * 60 * 1000,
  );
  if (step3.code !== 0) {
    await failRun(runId, `ingest-sofascore thất bại (exit ${step3.code}): ${step3.stderr.slice(-2000)}`);
    return;
  }

  const summaryLine = step3.stdout.split("\n").find((line) => line.startsWith("INGEST_SUMMARY_JSON "));
  const ingestSummary = summaryLine ? JSON.parse(summaryLine.slice("INGEST_SUMMARY_JSON ".length)) : null;

  await prisma.scraperRun.update({
    where: { id: runId },
    data: {
      status: scraperBlockedMidBatch ? "FAILED" : "SUCCESS",
      errorMessage: scraperBlockedMidBatch
        ? `Bị chặn giữa batch sau ${matchesScraped}/${matchesFound} trận — đã ingest phần dữ liệu scrape được.`
        : null,
      ingestSummary,
      finishedAt: new Date(),
    },
  });
}
