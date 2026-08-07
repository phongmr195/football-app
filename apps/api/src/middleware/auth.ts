import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

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

export const requireAuth: MiddlewareHandler = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

  if (!token) {
    return c.json({ error: "missing bearer token" }, 401);
  }

  try {
    const decoded = await getFirebaseAuth().verifyIdToken(token);
    c.set("userId", decoded.uid);
  } catch {
    return c.json({ error: "invalid token" }, 401);
  }

  await next();
});
