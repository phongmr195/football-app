import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { prisma } from "@football-app/database";

// Local dev: set FIREBASE_AUTH_EMULATOR_HOST (ví dụ "127.0.0.1:9099") — firebase-admin
// tự route verifyIdToken tới Auth Emulator, không cần project/credentials thật.
// Production: set FIREBASE_SERVICE_ACCOUNT (JSON) hoặc GOOGLE_APPLICATION_CREDENTIALS.
function getFirebaseAuth() {
  if (getApps().length === 0) {
    initializeApp(
      process.env.FIREBASE_SERVICE_ACCOUNT
        ? { credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) }
        : { projectId: process.env.FIREBASE_PROJECT_ID },
    );
  }
  return getAuth();
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
async function resolveOrCreateUserId(firebaseUid: string, email: string | undefined): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { firebaseUid } });
  if (existing) return existing.id;

  const created = await prisma.user.create({
    data: { firebaseUid, email: email ?? null },
  });
  return created.id;
}

export const requireAuth: MiddlewareHandler = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

  if (!token) {
    return c.json({ error: "missing bearer token" }, 401);
  }

  try {
    const decoded = await getFirebaseAuth().verifyIdToken(token);
    const userId = await resolveOrCreateUserId(decoded.uid, decoded.email);
    c.set("userId", userId);
  } catch {
    return c.json({ error: "invalid token" }, 401);
  }

  await next();
});
