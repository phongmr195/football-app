import { existsSync } from "node:fs";
import path from "node:path";

// packages/database's Prisma Client tự đọc packages/database/.env qua cơ chế riêng của nó (xem
// CLAUDE.md) nên DATABASE_URL luôn có sẵn dù chạy cách nào — nhưng KHÔNG có gì tương tự cho env
// var riêng của apps/api (FIREBASE_*, ADMIN_JWT_SECRET, CORS_ORIGIN, PORT...). `tsx watch
// src/index.ts` (package.json's "dev") không tự load .env — chạy qua Docker thì có (docker-compose
// inject qua `environment:`), nhưng chạy trực tiếp `pnpm --filter @football-app/api dev` ngoài
// Docker (CLAUDE.md § Authentication khuyên dùng cách này khi test Firebase project thật) thì
// KHÔNG — mọi env var trên đều `undefined` trong process thật dù .env có giá trị đúng trên disk.
// Bug thật đã gặp (2026-08-20): admin login đúng mật khẩu vẫn 500 (thiếu ADMIN_JWT_SECRET khi ký
// JWT) + /favorites/teams luôn 401 dù đăng nhập lại (thiếu FIREBASE_PROJECT_ID khiến
// verifyIdToken không xác định đúng audience).
//
// Import module này ĐẦU TIÊN trong index.ts (trước khi import "./app" — app.ts đọc CORS_ORIGIN ở
// top-level lúc module evaluate) để đảm bảo .env load xong trước khi bất kỳ module nào khác đọc
// process.env. `loadEnvFile` (Node built-in, không cần thêm dependency `dotenv`) KHÔNG override
// env var đã có sẵn thật trong process (verify thật: giữ nguyên giá trị docker-compose inject,
// chỉ điền vào chỗ còn thiếu) — an toàn gọi vô điều kiện ở mọi môi trường.
const envPath = path.resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
