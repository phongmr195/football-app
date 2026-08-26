import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { prisma } from "@football-app/database";

// Dùng chung 1 firebase-admin App cho CẢ verifyIdToken (auth) LẪN sendEachForMulticast (FCM, xem
// src/realtime/goal-notifier.ts) — initializeApp() throw "app already exists" nếu gọi lần 2, nên
// MỌI nơi trong apps/api cần firebase-admin PHẢI qua getFirebaseApp() này, không tự gọi
// initializeApp() riêng. Local dev: set FIREBASE_AUTH_EMULATOR_HOST (ví dụ "127.0.0.1:9099") —
// firebase-admin tự route verifyIdToken tới Auth Emulator, không cần project/credentials thật.
// Production: set FIREBASE_SERVICE_ACCOUNT (JSON) hoặc GOOGLE_APPLICATION_CREDENTIALS.
export function getFirebaseApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0]!;

  return initializeApp(
    process.env.FIREBASE_SERVICE_ACCOUNT
      ? { credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) }
      : { projectId: process.env.FIREBASE_PROJECT_ID },
  );
}

function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
  }
}

// Resolve-or-create: mọi route auth dùng chung logic này để c.get("userId") luôn là
// User.id (cuid) nội bộ, FK-safe cho các bảng như FavoriteTeam/FavoritePlayer — không phải
// raw Firebase UID. Chưa có flow signup/profile riêng ở Phase 1 nên provision just-in-time
// ở request đầu tiên.
async function resolveOrCreateUserId(
  firebaseUid: string,
  email: string | undefined,
  name: string | undefined,
): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { firebaseUid }, include: { profile: true } });
  if (existing) {
    // Backfill UserProfile.displayName cho user đăng nhập Google/Facebook — trước giờ KHÔNG có
    // gì ghi field này (chỉ set cho username/password qua auth.ts's /auth/register), nên mọi nơi
    // đọc displayName (vd MatchComments.tsx) đều rơi về fallback chung chung. CHỈ set khi còn
    // trống — không ghi đè nếu user đã tự đổi tên trong app sau này.
    if (name && !existing.profile?.displayName) {
      await prisma.userProfile.upsert({
        where: { userId: existing.id },
        create: { userId: existing.id, displayName: name },
        update: { displayName: name },
      });
    }
    return existing.id;
  }

  const created = await prisma.user.create({
    data: {
      firebaseUid,
      email: email ?? null,
      profile: name ? { create: { displayName: name } } : undefined,
    },
  });
  return created.id;
}

export const requireAuth: MiddlewareHandler = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

  if (!token) {
    return c.json({ error: "missing bearer token" }, 401);
  }

  let decoded;
  try {
    decoded = await getFirebaseAuth().verifyIdToken(token);
  } catch {
    return c.json({ error: "invalid token" }, 401);
  }

  // Lỗi TỪ ĐÂY (DB) không liên quan gì tới việc token có hợp lệ hay không — để throw ra ngoài
  // (Hono's error handler trả 500) thay vì báo nhầm "invalid token" 401. Bug thật đã gặp
  // (2026-08-20): native Postgres âm thầm giành port 5432 khỏi Docker (xem CLAUDE.md § Docker),
  // mọi request tưởng "token sai" trong lúc thật ra DB đang trỏ sai — nhét chung vào 1 try/catch
  // với verifyIdToken() che mất lỗi DB thật, làm debug đi sai hướng.
  const userId = await resolveOrCreateUserId(
    decoded.uid,
    decoded.email,
    typeof decoded.name === "string" ? decoded.name : undefined,
  );
  c.set("userId", userId);

  await next();
});

// Biến thể không bắt buộc đăng nhập của requireAuth — dùng cho route công khai nhưng muốn cá
// nhân hoá NẾU đã đăng nhập (vd /search ghi search_history theo user). Trả undefined thay vì
// 401 khi thiếu/token không hợp lệ, KHÔNG set c.set("userId") (route tự đọc giá trị trả về thay
// vì c.get("userId") — tránh xung đột với type ContextVariableMap.userId: string ở trên, vốn
// giả định đã qua requireAuth).
export async function tryResolveUserId(c: Context): Promise<string | undefined> {
  const authHeader = c.req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
  if (!token) return undefined;

  let decoded;
  try {
    decoded = await getFirebaseAuth().verifyIdToken(token);
  } catch {
    return undefined;
  }

  // Cùng lý do requireAuth ở trên — lỗi DB ở đây không phải "chưa đăng nhập", để throw ra ngoài
  // thay vì coi như user ẩn danh (che mất lỗi thật).
  return await resolveOrCreateUserId(
    decoded.uid,
    decoded.email,
    typeof decoded.name === "string" ? decoded.name : undefined,
  );
}
