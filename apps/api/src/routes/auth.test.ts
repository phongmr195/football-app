import { prisma } from "@football-app/database";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";

// createCustomToken() gọi Firebase Admin SDK thật — mock hẳn module này, cùng pattern
// goal-notifier.test.ts's mock "firebase-admin/messaging".
const mockCreateCustomToken = vi.fn();
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ createCustomToken: mockCreateCustomToken }),
}));

// Prefix ngắn, KHÔNG dấu gạch ngang (username schema chỉ cho phép [a-zA-Z0-9_], xem auth.ts) —
// base36 timestamp giữ tổng độ dài trong giới hạn 20 ký tự của schema thật.
const USERNAME_PREFIX = "atu";
let usernameCounter = 0;
function uniqueUsername(): string {
  usernameCounter += 1;
  return `${USERNAME_PREFIX}${Date.now().toString(36)}${usernameCounter}`;
}

async function cleanupTestData() {
  await prisma.user.deleteMany({ where: { username: { startsWith: USERNAME_PREFIX } } });
}

beforeEach(async () => {
  await cleanupTestData();
  mockCreateCustomToken.mockReset();
  mockCreateCustomToken.mockResolvedValue("fake-custom-token");
});
afterAll(cleanupTestData);

function registerBody(overrides: Partial<Record<string, string>> = {}) {
  return {
    fullName: "Nguyễn Văn A",
    username: uniqueUsername(),
    password: "Password123",
    confirmPassword: "Password123",
    ...overrides,
  };
}

async function postJson(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /auth/register", () => {
  it("201 — tạo User + UserProfile, trả customToken, mật khẩu được hash (không lưu plaintext)", async () => {
    const body = registerBody();
    const res = await postJson("/auth/register", body);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toEqual({ customToken: "fake-custom-token" });

    const user = await prisma.user.findUnique({
      where: { username: body.username.toLowerCase() },
      include: { profile: true },
    });
    expect(user).not.toBeNull();
    expect(user?.profile?.displayName).toBe("Nguyễn Văn A");
    expect(user?.passwordHash).not.toBeNull();
    expect(user?.passwordHash).not.toBe(body.password);
    expect(user?.firebaseUid.startsWith("pw_")).toBe(true);

    expect(mockCreateCustomToken).toHaveBeenCalledWith(user?.firebaseUid);
  });

  it("username tự động lowercase — 'TestUser' và 'testuser' bị coi là trùng", async () => {
    const username = uniqueUsername();
    const first = await postJson("/auth/register", registerBody({ username }));
    expect(first.status).toBe(201);

    const second = await postJson("/auth/register", registerBody({ username: username.toUpperCase() }));
    expect(second.status).toBe(409);
  });

  it("409 khi username đã tồn tại", async () => {
    const username = uniqueUsername();
    await postJson("/auth/register", registerBody({ username }));

    const res = await postJson("/auth/register", registerBody({ username }));
    expect(res.status).toBe(409);
  });

  it("400 khi confirmPassword không khớp password", async () => {
    const res = await postJson(
      "/auth/register",
      registerBody({ confirmPassword: "different123" }),
    );
    expect(res.status).toBe(400);
  });

  it("400 khi password không có chữ số (chỉ toàn chữ cái)", async () => {
    const res = await postJson(
      "/auth/register",
      registerBody({ password: "onlyletters", confirmPassword: "onlyletters" }),
    );
    expect(res.status).toBe(400);
  });

  it("400 khi password ngắn hơn 8 ký tự", async () => {
    const res = await postJson("/auth/register", registerBody({ password: "ab1", confirmPassword: "ab1" }));
    expect(res.status).toBe(400);
  });

  it("400 khi username chứa ký tự không hợp lệ (khoảng trắng/ký tự đặc biệt)", async () => {
    const res = await postJson("/auth/register", registerBody({ username: "invalid user!" }));
    expect(res.status).toBe(400);
  });

  it("400 khi fullName rỗng", async () => {
    const res = await postJson("/auth/register", registerBody({ fullName: "" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  it("200 — đúng username/password, trả customToken", async () => {
    const body = registerBody();
    await postJson("/auth/register", body);

    const res = await postJson("/auth/login", { username: body.username, password: body.password });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ customToken: "fake-custom-token" });
  });

  it("login username khác hoa/thường vẫn thành công (lowercase-normalized)", async () => {
    const body = registerBody();
    await postJson("/auth/register", body);

    const res = await postJson("/auth/login", {
      username: body.username.toUpperCase(),
      password: body.password,
    });
    expect(res.status).toBe(200);
  });

  it("401 khi sai password", async () => {
    const body = registerBody();
    await postJson("/auth/register", body);

    const res = await postJson("/auth/login", { username: body.username, password: "wrongpassword1" });
    expect(res.status).toBe(401);
  });

  it("401 khi username không tồn tại", async () => {
    const res = await postJson("/auth/login", {
      username: `${USERNAME_PREFIX}nonexistent`,
      password: "password123",
    });
    expect(res.status).toBe(401);
  });

  it("401 (không phải 500) khi user tồn tại nhưng KHÔNG có passwordHash (vd đăng ký qua Google)", async () => {
    const username = uniqueUsername();
    await prisma.user.create({
      data: { firebaseUid: `google-uid-${Date.now()}`, username, passwordHash: null },
    });

    const res = await postJson("/auth/login", { username, password: "password123" });
    expect(res.status).toBe(401);
  });
});
