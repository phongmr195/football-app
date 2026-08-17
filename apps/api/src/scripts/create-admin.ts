/**
 * Tạo (hoặc reset password) 1 admin user — chạy:
 *   pnpm --filter @football-app/api create-admin <username> <password>
 *
 * upsert theo username: chạy lại với cùng username sẽ RESET password thay vì báo lỗi trùng —
 * hữu ích khi quên mật khẩu, không cần thao tác DB tay. Đây là cách duy nhất để tạo admin đầu
 * tiên (không có flow tự đăng ký admin qua UI — xem ROADMAP.md Phase 4).
 */
import { prisma } from "@football-app/database";
import { hashPassword } from "@football-app/shared";

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error("Usage: pnpm --filter @football-app/api create-admin <username> <password>");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const adminUser = await prisma.adminUser.upsert({
    where: { username },
    create: { username, passwordHash },
    update: { passwordHash },
  });

  console.log(`OK — admin user "${adminUser.username}" (id=${adminUser.id}) ready.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("create-admin failed:", err);
    process.exit(1);
  });
