import { spawn } from "node:child_process";
import path from "node:path";

// apps/api luôn chạy với cwd = apps/api (dev qua tsx watch, prod qua node dist/index.js — cả 2 đều
// invoke từ trong thư mục này, xem package.json's "dev"/"start" script) — an toàn để resolve theo
// process.cwd() thay vì cần import.meta.url/__dirname (không có precedent nào trong repo).
export const REPO_ROOT = path.resolve(process.cwd(), "../..");
export const SYNC_WORKER_DIR = path.resolve(REPO_ROOT, "apps/sync-worker");
// Gọi thẳng tsx's binary (script shell dùng `exec` thay tiến trình, KHÔNG fork con) thay vì
// `pnpm --filter @football-app/sync-worker <script>` — verify thật 2026-08-19: dù đã đổi "close"
// sang "exit" (xem comment ở runProcess), bước chạy QUA PNPM vẫn tiếp tục kẹt RUNNING vĩnh viễn dù
// script con đã chạy xong + ghi DB thành công thật. pnpm tự thân là 1 chương trình Node đầy đủ, tự
// quản lý vòng đời tiến trình con + có thể trì hoãn tự thoát (update notifier/telemetry) theo cách
// không kiểm soát được từ bên ngoài — bỏ hẳn pnpm khỏi chain, spawn tsx trực tiếp để chỉ còn 1 lớp
// tiến trình (thay vì apps/api -> pnpm -> tsx).
export const SYNC_WORKER_TSX_BIN = path.resolve(SYNC_WORKER_DIR, "node_modules/.bin/tsx");

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Dùng chung bởi scraper-orchestrator.ts (Sofascore pipeline) và sync-orchestrator.ts
// (football-data catalog sync) — cả 2 đều sống trong apps/api, khác nguyên tắc "duplicate nhỏ hơn
// coupling" chỉ áp dụng CHÉO app (apps/api <-> apps/sync-worker), không áp dụng trong cùng 1 app.
//
// spawn() (KHÔNG exec — array args, tránh shell injection dù input đã validate ở route). Bắt buộc
// có "error" listener — ChildProcess's "error" event (vd ENOENT nếu command không tồn tại) sẽ crash
// cả tiến trình apps/api nếu không nghe, giống nguyên tắc goal-notifier.ts đã áp dụng cho ioredis.
export function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProcessResult> {
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
