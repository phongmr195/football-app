import { prisma } from "@football-app/database";

// Duplicate của apps/sync-worker/src/logger.ts — apps/api và apps/sync-worker không import code
// qua lại (2 app riêng, xem CLAUDE.md). Chỉ ghi ERROR/WARN vào SystemLog (KHÔNG mọi console.log) —
// dùng ở đúng các catch-block "fire-and-forget không được throw ra ngoài" đã có sẵn
// (goal-notifier.ts, redis-subscriber.ts...) và app.onError (app.ts) cho lỗi 500 chưa bắt được ở
// tầng route. Luôn console.error/warn NHƯ CŨ song song — ghi DB là lớp bổ sung, không thay thế.
function toDetail(err: unknown): object | undefined {
  if (err instanceof Error) {
    const detail: Record<string, unknown> = { message: err.message, stack: err.stack?.slice(0, 4000) };
    // fetch's real error reason (ENOTFOUND/timeout...) lives in `cause`, not message.
    if (err.cause !== undefined) detail.cause = toDetail(err.cause);
    if (err instanceof AggregateError) detail.errors = err.errors.map((e) => toDetail(e));
    return detail;
  }
  if (err === undefined) return undefined;
  // Object thường (không phải Error) — lưu nguyên (Prisma Json field nhận trực tiếp), KHÔNG
  // String() nó (sẽ ra "[object Object]" vô dụng, bug thật gặp lúc verify 2026-08-24).
  if (typeof err === "object" && err !== null) return err as object;
  return { value: String(err) };
}

// Duplicate của apps/sync-worker/src/logger.ts's hằng số cùng tên — retention áp dụng chung cho
// toàn bộ SystemLog (cả 2 service ghi vào 1 bảng), chỉ cần khớp giá trị, không cần import chung.
const SYSTEM_LOG_RETENTION_DAYS = 30;

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // tự dọn tối đa 1 lần/ngày, không cần chạy mỗi lần ghi log
let lastCleanupAt = 0;

// Tự trigger MỖI LẦN có log mới được ghi (gọi trong logError/logWarn dưới) — không cần nút dọn
// tay riêng hay cron riêng: throttle nội bộ (so sánh timestamp, KHÔNG query DB nếu chưa tới hạn)
// đảm bảo chỉ thực sự chạy DELETE tối đa 1 lần/ngày dù logError/logWarn có thể gọi rất nhiều lần
// trong ngày đó. apps/api và apps/sync-worker mỗi bên tự có throttle riêng (module-state riêng
// process) — cùng xoá row của CẢ 2 service (1 bảng chung), không sao nếu cả 2 process cùng chạy
// gần giờ nhau, deleteMany() với cùng điều kiện idempotent tự nhiên.
function cleanupOldSystemLogsIfNeeded(): void {
  if (Date.now() - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = Date.now();

  const cutoff = new Date(Date.now() - SYSTEM_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  prisma.systemLog
    .deleteMany({ where: { createdAt: { lt: cutoff } } })
    .then((result) => {
      if (result.count > 0) console.log(`cleanupOldSystemLogsIfNeeded: đã xoá ${result.count} log cũ hơn ${SYSTEM_LOG_RETENTION_DAYS} ngày`);
    })
    .catch((err) => {
      console.error("cleanupOldSystemLogsIfNeeded: xoá SystemLog cũ thất bại", err);
    });
}

// Trả về Promise (KHÔNG tự void ở đây) — call site fire-and-forget tự `void logError(...)`, cùng
// convention `void x().catch()` dùng xuyên suốt codebase; chỗ nào cần chắc chắn ghi xong trước khi
// tiếp tục (hiếm) có thể tự await.
export function logError(message: string, err?: unknown): Promise<void> {
  console.error(message, err);
  cleanupOldSystemLogsIfNeeded();
  return prisma.systemLog
    .create({
      data: { service: "API", level: "ERROR", message: message.slice(0, 2000), detail: toDetail(err) },
    })
    .then(() => {})
    .catch((dbErr) => {
      console.error("logError: ghi SystemLog thất bại", dbErr);
    });
}

export function logWarn(message: string, detail?: unknown): Promise<void> {
  console.warn(message, detail);
  cleanupOldSystemLogsIfNeeded();
  return prisma.systemLog
    .create({
      data: { service: "API", level: "WARN", message: message.slice(0, 2000), detail: toDetail(detail) },
    })
    .then(() => {})
    .catch((dbErr) => {
      console.error("logWarn: ghi SystemLog thất bại", dbErr);
    });
}
