import { prisma } from "@football-app/database";
import type { MatchFinishedEvent } from "@football-app/realtime";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMatchFinishedEvent } from "./match-finished-notifier";

// Cùng lý do/pattern goal-notifier.test.ts — mock "firebase-admin/messaging" để không gọi FCM
// thật.
const mockSendEachForMulticast = vi.fn();
vi.mock("firebase-admin/messaging", () => ({
  getMessaging: () => ({ sendEachForMulticast: mockSendEachForMulticast }),
}));

const PROVIDER = "match-finished-notifier-test-provider";
const ref = (id: string) => ({ provider: PROVIDER, id });

let userCounter = 0;
async function createUser(overrides: { matchResultAlerts?: boolean } = {}) {
  const n = ++userCounter;
  const user = await prisma.user.create({
    data: {
      firebaseUid: `match-finished-notifier-test-uid-${n}`,
      email: `match-finished-notifier-test-${n}@example.com`,
    },
  });
  if (overrides.matchResultAlerts !== undefined) {
    await prisma.notificationSetting.create({
      data: { userId: user.id, matchResultAlerts: overrides.matchResultAlerts },
    });
  }
  return user;
}

async function addDevice(userId: string, fcmToken: string) {
  return prisma.device.create({ data: { userId, fcmToken, platform: "WEB" } });
}

async function favoriteTeam(userId: string, teamId: string) {
  return prisma.favoriteTeam.create({ data: { userId, teamId } });
}

async function cleanupTestData() {
  await prisma.user.deleteMany({ where: { firebaseUid: { startsWith: "match-finished-notifier-test-uid-" } } });
  await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
}

beforeEach(async () => {
  await cleanupTestData();
  userCounter = 0;
  mockSendEachForMulticast.mockReset();
  mockSendEachForMulticast.mockImplementation(async ({ tokens }: { tokens: string[] }) => ({
    responses: tokens.map(() => ({ success: true })),
    successCount: tokens.length,
    failureCount: 0,
  }));
});
afterAll(cleanupTestData);

function makeEvent(
  homeTeamId: string,
  awayTeamId: string,
  overrides: Partial<MatchFinishedEvent> = {},
): MatchFinishedEvent {
  return {
    matchId: "match-1",
    homeTeamId,
    awayTeamId,
    homeTeamName: "Home FC",
    awayTeamName: "Away FC",
    homeScore: 2,
    awayScore: 1,
    finishedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("handleMatchFinishedEvent", () => {
  it("user favorite đội HOME -> được notify kèm đúng tỉ số trong body", async () => {
    const home = await prisma.team.create({ data: { name: "Home FC", externalRef: ref("home-1") as object } });
    const away = await prisma.team.create({ data: { name: "Away FC", externalRef: ref("away-1") as object } });
    const user = await createUser();
    await addDevice(user.id, `token-home-${user.id}`);
    await favoriteTeam(user.id, home.id);

    await handleMatchFinishedEvent(makeEvent(home.id, away.id));

    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: [`token-home-${user.id}`],
        notification: expect.objectContaining({ body: "Home FC 2 - 1 Away FC" }),
      }),
    );

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("match_result");
  });

  it("user favorite đội AWAY (không phải home) -> vẫn được notify", async () => {
    const home = await prisma.team.create({ data: { name: "Home FC", externalRef: ref("home-2") as object } });
    const away = await prisma.team.create({ data: { name: "Away FC", externalRef: ref("away-2") as object } });
    const user = await createUser();
    await addDevice(user.id, `token-away-${user.id}`);
    await favoriteTeam(user.id, away.id);

    await handleMatchFinishedEvent(makeEvent(home.id, away.id));

    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
  });

  it("user favorite CẢ 2 đội (home lẫn away) -> chỉ nhận 1 noti, không nhân đôi", async () => {
    const home = await prisma.team.create({ data: { name: "Home FC", externalRef: ref("home-3") as object } });
    const away = await prisma.team.create({ data: { name: "Away FC", externalRef: ref("away-3") as object } });
    const user = await createUser();
    await addDevice(user.id, `token-both-${user.id}`);
    await favoriteTeam(user.id, home.id);
    await favoriteTeam(user.id, away.id);

    await handleMatchFinishedEvent(makeEvent(home.id, away.id));

    // findNotifiableFavorites() trả 2 FavoriteTeam row (1/đội) cho user này — handler dedupe theo
    // userId trước khi loop nên chỉ gửi FCM đúng 1 lần, không nhân đôi.
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
  });

  it("user matchResultAlerts: false -> KHÔNG được notify", async () => {
    const home = await prisma.team.create({ data: { name: "Home FC", externalRef: ref("home-4") as object } });
    const away = await prisma.team.create({ data: { name: "Away FC", externalRef: ref("away-4") as object } });
    const user = await createUser({ matchResultAlerts: false });
    await addDevice(user.id, `token-opt-out-${user.id}`);
    await favoriteTeam(user.id, home.id);

    await handleMatchFinishedEvent(makeEvent(home.id, away.id));

    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(0);
  });

  it("user KHÔNG có NotificationSetting row -> vẫn được notify (mặc định matchResultAlerts: true)", async () => {
    const home = await prisma.team.create({ data: { name: "Home FC", externalRef: ref("home-5") as object } });
    const away = await prisma.team.create({ data: { name: "Away FC", externalRef: ref("away-5") as object } });
    const user = await createUser();
    await addDevice(user.id, `token-default-${user.id}`);
    await favoriteTeam(user.id, home.id);

    await handleMatchFinishedEvent(makeEvent(home.id, away.id));

    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  it("user không có Device nào -> vẫn ghi Notification in-app, chỉ không gọi FCM", async () => {
    // Cùng fix goal-notifier.ts (2026-08-24) — user chưa từng bật push/đang offline lúc trận kết
    // thúc vẫn phải thấy kết quả trong bell icon khi mở web sau đó.
    const home = await prisma.team.create({ data: { name: "Home FC", externalRef: ref("home-6") as object } });
    const away = await prisma.team.create({ data: { name: "Away FC", externalRef: ref("away-6") as object } });
    const user = await createUser();
    await favoriteTeam(user.id, home.id);

    await expect(handleMatchFinishedEvent(makeEvent(home.id, away.id))).resolves.toBeUndefined();
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("match_result");
  });

  it("ghi Notification + NotificationLog đúng SENT/FAILED theo response FCM", async () => {
    const home = await prisma.team.create({ data: { name: "Home FC", externalRef: ref("home-7") as object } });
    const away = await prisma.team.create({ data: { name: "Away FC", externalRef: ref("away-7") as object } });
    const user = await createUser();
    const okToken = `token-ok-${user.id}`;
    const failToken = `token-fail-${user.id}`;
    await addDevice(user.id, okToken);
    await addDevice(user.id, failToken);
    await favoriteTeam(user.id, home.id);

    mockSendEachForMulticast.mockImplementation(async ({ tokens }: { tokens: string[] }) => ({
      responses: tokens.map((token) =>
        token === failToken
          ? { success: false, error: { message: "registration-token-not-registered" } }
          : { success: true },
      ),
      successCount: tokens.filter((t) => t !== failToken).length,
      failureCount: tokens.filter((t) => t === failToken).length,
    }));

    await handleMatchFinishedEvent(makeEvent(home.id, away.id));

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);

    const logs = await prisma.notificationLog.findMany({
      where: { notificationId: notifications[0]?.id },
      orderBy: { sentAt: "asc" },
    });
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.status).sort()).toEqual(["FAILED", "SENT"]);
  });
});
