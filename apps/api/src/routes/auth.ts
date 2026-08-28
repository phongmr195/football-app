import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import { hashPassword, verifyPassword } from "@football-app/shared";
import { getAuth } from "firebase-admin/auth";
import { Hono } from "hono";
import { z } from "zod";
import { getFirebaseApp, requireAuth } from "../middleware/auth";
import { logError } from "../logger";

// Đăng ký/đăng nhập username+password cho USER THƯỜNG — hoàn toàn khác admin.ts's /admin/login
// (AdminUser riêng, tự ký JWT). Ở đây vẫn bám theo hạ tầng Firebase Auth hiện có (requireAuth chỉ
// biết verify Firebase ID token, xem middleware/auth.ts) thay vì thêm 1 cơ chế session song song:
// đăng ký/đăng nhập thành công -> mint 1 Firebase custom token (firebase-admin's
// createCustomToken(uid)) -> client signInWithCustomToken() -> ra Firebase ID token THẬT ->
// mọi API hiện có (favorites, notifications...) không cần sửa gì. `uid` truyền vào
// createCustomToken() LUÔN LÀ User.firebaseUid đã lưu sẵn (tự sinh, không phải Firebase cấp) —
// xem comment ở model User trong schema.prisma cho lý do đầy đủ.
const usernameSchema = z
  .string()
  .trim()
  .min(3, "Tên đăng nhập phải có ít nhất 3 ký tự")
  .max(20, "Tên đăng nhập tối đa 20 ký tự")
  .regex(/^[a-zA-Z0-9_]+$/, "Tên đăng nhập chỉ gồm chữ, số và dấu gạch dưới");

const passwordSchema = z
  .string()
  .min(8, "Mật khẩu phải có ít nhất 8 ký tự")
  .regex(/[A-Za-z]/, "Mật khẩu phải có ít nhất 1 chữ cái")
  .regex(/[A-Z]/, "Mật khẩu phải có ít nhất 1 chữ hoa")
  .regex(/[0-9]/, "Mật khẩu phải có ít nhất 1 chữ số");

const registerBodySchema = z
  .object({
    fullName: z.string().trim().min(2, "Họ tên phải có ít nhất 2 ký tự").max(100, "Họ tên tối đa 100 ký tự"),
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Xác nhận mật khẩu không khớp",
    path: ["confirmPassword"],
  });

const loginBodySchema = z.object({
  username: z.string().min(1, "Nhập tên đăng nhập"),
  password: z.string().min(1, "Nhập mật khẩu"),
});

export const authRoute = new Hono()
  .post("/auth/register", zValidator("json", registerBodySchema), async (c) => {
    const { fullName, username, password } = c.req.valid("json");
    // Lowercase để unique constraint không phân biệt hoa/thường (xem comment ở schema.prisma) —
    // "Admin"/"admin" phải bị coi là trùng.
    const normalizedUsername = username.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { username: normalizedUsername } });
    if (existing) {
      return c.json({ error: "Tên đăng nhập đã được sử dụng" }, 409);
    }

    const passwordHash = await hashPassword(password);
    // Prefix "pw_" chỉ để dễ nhận ra trong log/DB (khác Firebase-cấp thật, thường không có prefix
    // cố định) — không có ý nghĩa gì với Firebase, chỉ cần unique.
    const firebaseUid = `pw_${randomUUID()}`;

    let user;
    try {
      user = await prisma.user.create({
        data: {
          firebaseUid,
          username: normalizedUsername,
          passwordHash,
          profile: { create: { displayName: fullName } },
        },
      });
    } catch (err) {
      // Race hiếm: 2 request đăng ký cùng username gần như đồng thời, cả 2 đều pass check findUnique
      // ở trên trước khi request kia commit — DB's unique constraint vẫn chặn đúng, chỉ cần trả
      // lỗi rõ ràng thay vì để lộ ra thành 500 (Prisma P2002).
      if (err instanceof Error && "code" in err && err.code === "P2002") {
        return c.json({ error: "Tên đăng nhập đã được sử dụng" }, 409);
      }
      throw err;
    }

    try {
      const customToken = await getAuth(getFirebaseApp()).createCustomToken(user.firebaseUid);
      return c.json({ customToken }, 201);
    } catch (err) {
      // User đã tạo xong trong DB — mint token lỗi chỉ mất bước auto-login ngay sau đăng ký,
      // KHÔNG mất tài khoản. User có thể tự đăng nhập lại ngay sau (route /auth/login mint token
      // riêng), nên trả lỗi rõ ràng thay vì 500 chung chung.
      void logError(`auth: createCustomToken thất bại cho user ${user.id} (vừa đăng ký xong)`, err);
      return c.json(
        { error: "Đăng ký thành công nhưng đăng nhập tự động thất bại, hãy thử đăng nhập lại" },
        500,
      );
    }
  })
  .post("/auth/login", zValidator("json", loginBodySchema), async (c) => {
    const { username, password } = c.req.valid("json");
    const normalizedUsername = username.toLowerCase();

    const user = await prisma.user.findUnique({ where: { username: normalizedUsername } });
    // Lỗi chung chung cho cả 2 trường hợp (không tìm thấy username / sai password / user đăng ký
    // qua Google-Facebook không có passwordHash) — cùng convention admin.ts's /admin/login, không
    // tiết lộ username nào tồn tại thật.
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return c.json({ error: "Sai tên đăng nhập hoặc mật khẩu" }, 401);
    }

    let customToken: string;
    try {
      customToken = await getAuth(getFirebaseApp()).createCustomToken(user.firebaseUid);
    } catch (err) {
      void logError(`auth: createCustomToken thất bại cho user ${user.id}`, err);
      return c.json({ error: "Đăng nhập thất bại, thử lại sau" }, 500);
    }

    return c.json({ customToken });
  })
  // Client chỉ biết Firebase UID, không biết internal User.id (cuid) mà mentionedUserIds/author.id
  // dùng — cần endpoint này để so khớp "mình có bị mention không".
  .get("/auth/me", requireAuth, async (c) => {
    return c.json({ id: c.get("userId") });
  });
