import { compare, hash } from "bcryptjs";

// Dùng chung giữa apps/api (verify khi login, apps/api/src/routes/admin.ts) và
// apps/api/scripts/create-admin.ts (hash khi tạo/reset admin user) — AdminUser.passwordHash
// (packages/database/prisma/schema.prisma), KHÔNG liên quan tới Firebase auth của User thường.
const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return compare(plain, passwordHash);
}
