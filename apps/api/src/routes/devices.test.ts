import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";

// requireAuth gọi getFirebaseAuth().verifyIdToken(token) (middleware/auth.ts) — mock module
// "firebase-admin/auth" để test không cần Auth Emulator/project thật chạy, cùng triết lý mock
// firebase-admin của goal-notifier.test.ts (mock "firebase-admin/messaging"). initializeApp()
// thật (từ "firebase-admin/app", KHÔNG mock) vẫn được gọi bên trong getFirebaseApp() — vô hại vì
// không cần network, chỉ construct 1 App instance local.
const VALID_TOKEN = "valid-test-token";
const FIREBASE_UID = "devices-test-firebase-uid";
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (token === VALID_TOKEN) return { uid: FIREBASE_UID, email: "devices-test@example.com" };
      throw new Error("invalid token");
    },
  }),
}));

async function cleanupTestData() {
  await prisma.user.deleteMany({ where: { firebaseUid: FIREBASE_UID } });
}

beforeEach(cleanupTestData);
afterAll(cleanupTestData);

describe("POST /devices", () => {
  it("401 khi chưa có bearer token", async () => {
    const res = await app.request("/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fcmToken: "token-1", platform: "WEB" }),
    });
    expect(res.status).toBe(401);
  });

  it("tạo Device mới cho user, keyed đúng theo firebaseUid resolve-or-create", async () => {
    const res = await app.request("/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${VALID_TOKEN}` },
      body: JSON.stringify({ fcmToken: "devices-test-token-1", platform: "WEB" }),
    });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { firebaseUid: FIREBASE_UID } });
    const devices = await prisma.device.findMany({ where: { userId: user.id } });
    expect(devices).toHaveLength(1);
    expect(devices[0]?.fcmToken).toBe("devices-test-token-1");
    expect(devices[0]?.platform).toBe("WEB");
  });

  it("re-post cùng fcmToken -> upsert, không tạo trùng (vẫn 1 row)", async () => {
    const first = await app.request("/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${VALID_TOKEN}` },
      body: JSON.stringify({ fcmToken: "devices-test-token-2", platform: "ANDROID" }),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${VALID_TOKEN}` },
      body: JSON.stringify({ fcmToken: "devices-test-token-2", platform: "IOS" }),
    });
    expect(second.status).toBe(200);

    const devices = await prisma.device.findMany({ where: { fcmToken: "devices-test-token-2" } });
    expect(devices).toHaveLength(1); // upsert, không tạo trùng
    expect(devices[0]?.platform).toBe("IOS"); // update áp dụng giá trị mới nhất
  });

  it("400 khi platform không hợp lệ (zValidator)", async () => {
    const res = await app.request("/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${VALID_TOKEN}` },
      body: JSON.stringify({ fcmToken: "devices-test-token-3", platform: "SMARTWATCH" }),
    });
    expect(res.status).toBe(400);
  });
});
