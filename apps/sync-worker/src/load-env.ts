import { existsSync } from "node:fs";
import path from "node:path";

// packages/database's Prisma Client tự đọc packages/database/.env qua cơ chế riêng của nó (xem
// CLAUDE.md) nên DATABASE_URL luôn có sẵn dù chạy cách nào — nhưng KHÔNG có gì tương tự cho env
// var riêng của apps/sync-worker (LLM_PROVIDER/ANTHROPIC_API_KEY/GEMINI_API_KEY/GROQ_API_KEY/
// DATA_PROVIDER/FOOTBALL_DATA_API_KEY...). `tsx src/local.ts`/`tsx src/poll.ts`/mọi script trong
// src/scripts/ không tự load .env khi chạy trực tiếp ngoài Docker (docker-compose inject qua
// `environment:` nên không cần) — cùng bug/fix pattern đã áp dụng cho apps/api's load-env.ts
// (commit "Load apps/api/.env at startup — was silently never loaded"). Bug thật đã gặp
// (2026-08-25): generateMatchSummaryIfNeeded() luôn rơi về AnthropicAdapter với apiKey rỗng (401
// "x-api-key header is required") dù .env đã set LLM_PROVIDER=gemini + GEMINI_API_KEY thật — vì
// process.env chưa từng thấy các giá trị đó khi chạy qua `pnpm --filter ... backfill-match-summaries`.
//
// Import module này ĐẦU TIÊN ở mọi entrypoint (local.ts, poll.ts, từng file trong src/scripts/)
// trước khi import bất kỳ module nào đọc process.env ở top-level. `loadEnvFile` (Node built-in,
// không cần thêm dependency `dotenv`) KHÔNG override env var đã có sẵn thật trong process — an
// toàn gọi vô điều kiện ở mọi môi trường (Docker/Render đã inject qua `environment:` vẫn giữ
// nguyên giá trị đó, chỉ điền vào chỗ còn thiếu).
const envPath = path.resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
