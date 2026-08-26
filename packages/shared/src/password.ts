import { compare, hash } from "bcryptjs";

// Dùng chung cho CẢ 2 loại password trong hệ thống: AdminUser.passwordHash (apps/api/src/routes/
// admin.ts + apps/api/scripts/create-admin.ts) VÀ User.passwordHash (đăng ký username/password
// của user thường, xem apps/api/src/routes/auth.ts) — cùng thuật toán/salt rounds, khác hoàn
// toàn về model/luồng xác thực (AdminUser tự ký JWT riêng, User mint Firebase custom token).
// File này từng tên "admin-password.ts" (chỉ AdminUser) — đổi tên 2026-08-24 khi User thường bắt
// đầu dùng chung, không đổi tên export.
const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return compare(plain, passwordHash);
}
