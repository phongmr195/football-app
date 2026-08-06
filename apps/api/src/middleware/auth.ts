import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

function getVerifier() {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
      clientId: process.env.COGNITO_CLIENT_ID ?? "",
      tokenUse: "access",
    });
  }
  return verifier;
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
    const payload = await getVerifier().verify(token);
    c.set("userId", payload.sub);
  } catch {
    return c.json({ error: "invalid token" }, 401);
  }

  await next();
});
