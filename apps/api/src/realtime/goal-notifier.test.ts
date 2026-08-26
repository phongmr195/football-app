import { prisma } from "@football-app/database";
import type { GoalEvent } from "@football-app/realtime";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleGoalEvent } from "./goal-notifier";

// handleGoalEvent() gọi getMessaging(getFirebaseApp()).sendEachForMulticast(...) trực tiếp — mock
// cả module "firebase-admin/messaging" để test không gọi network FCM thật, cùng style với cách
// apps/sync-worker mock "./provider"/"./realtime" (module trực tiếp phụ thuộc bên trong hàm dưới
// test, không nhận qua tham số). vi.mock() được Vitest hoist lên đầu file tự động, nên import
// handleGoalEvent ở trên vẫn nhận đúng bản mock.
const mockSendEachForMulticast = vi.fn();
vi.mock("firebase-admin/messaging", () => ({
  getMessaging: () => ({ sendEachForMulticast: mockSendEachForMulticast }),
}));

const PROVIDER = "goal-notifier-test-provider";
const ref = (id: string) => ({ provider: PROVIDER, id });

let userCounter = 0;
async function createUser(overrides: { goalAlerts?: boolean } = {}) {
  const n = ++userCounter;
  const user = await prisma.user.create({
    data: {
      firebaseUid: `goal-notifier-test-uid-${n}`,
      email: `goal-notifier-test-${n}@example.com`,
    },
  });
  if (overrides.goalAlerts !== undefined) {
    await prisma.notificationSetting.create({
      data: { userId: user.id, goalAlerts: overrides.goalAlerts },
    });
  }
  return user;
}

async function addDevice(userId: string, fcmToken: string) {
  return prisma.device.create({
    data: { userId, fcmToken, platform: "WEB" },
  });
}

async function favoriteTeam(userId: string, teamId: string) {
  return prisma.favoriteTeam.create({ data: { userId, teamId } });
}

async function cleanupTestData() {
  await prisma.user.deleteMany({ where: { firebaseUid: { startsWith: "goal-notifier-test-uid-" } } });
  await prisma.team.deleteMany({ where: { externalRef: { path: ["provider"], equals: PROVIDER } } });
}

beforeEach(async () => {
  await cleanupTestData();
  userCounter = 0;
  mockSendEachForMulticast.mockReset();
  mockSendEachForMulticast.mockImplementation(
    async ({ tokens }: { tokens: string[] }) => ({
      responses: tokens.map(() => ({ success: true })),
      successCount: tokens.length,
      failureCount: 0,
    }),
  );
});
afterAll(cleanupTestData);

function makeGoalEvent(teamId: string, overrides: Partial<GoalEvent> = {}): GoalEvent {
  return {
    matchId: "match-1",
    teamId,
    homeScore: 1,
    awayScore: 0,
    scoredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("handleGoalEvent", () => {
  it("user KHÔNG có NotificationSetting row -> vẫn được notify (mặc định goalAlerts: true)", async () => {
    const team = await prisma.team.create({ data: { name: "Team No Setting", externalRef: ref("team-no-setting") as object } });
    const user = await createUser(); // không tạo NotificationSetting
    await addDevice(user.id, `token-no-setting-${user.id}`);
    await favoriteTeam(user.id, team.id);

    await handleGoalEvent(makeGoalEvent(team.id));

    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: [`token-no-setting-${user.id}`] }),
    );

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("goal");

    const logs = await prisma.notificationLog.findMany({ where: { notificationId: notifications[0]?.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe("SENT");
    expect(logs[0]?.channel).toBe("FCM");
  });

  it("user goalAlerts: false -> KHÔNG được notify", async () => {
    const team = await prisma.team.create({ data: { name: "Team Opt Out", externalRef: ref("team-opt-out") as object } });
    const user = await createUser({ goalAlerts: false });
    await addDevice(user.id, `token-opt-out-${user.id}`);
    await favoriteTeam(user.id, team.id);

    await handleGoalEvent(makeGoalEvent(team.id));

    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(0);
  });

  it("user không có Device nào -> vẫn ghi Notification in-app, chỉ không gọi FCM", async () => {
    // Bug thật đã sửa 2026-08-24: user chưa từng bật push (không có Device nào) hoặc đang offline
    // lúc ghi bàn vẫn phải thấy thông báo này khi mở web sau đó (xem NotificationBell.tsx) — bản
    // ghi in-app KHÔNG được phụ thuộc việc có gửi FCM được hay không.
    const team = await prisma.team.create({ data: { name: "Team No Device", externalRef: ref("team-no-device") as object } });
    const user = await createUser(); // không có device
    await favoriteTeam(user.id, team.id);

    await expect(handleGoalEvent(makeGoalEvent(team.id))).resolves.toBeUndefined();

    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("goal");
    expect(notifications[0]?.readAt).toBeNull();
  });

  it("ghi Notification + NotificationLog đúng SENT/FAILED theo response FCM (nhiều device, 1 fail)", async () => {
    const team = await prisma.team.create({ data: { name: "Team Mixed", externalRef: ref("team-mixed") as object } });
    const user = await createUser({ goalAlerts: true });
    const okToken = `token-ok-${user.id}`;
    const failToken = `token-fail-${user.id}`;
    await addDevice(user.id, okToken);
    await addDevice(user.id, failToken);
    await favoriteTeam(user.id, team.id);

    mockSendEachForMulticast.mockImplementation(async ({ tokens }: { tokens: string[] }) => ({
      responses: tokens.map((token) =>
        token === failToken
          ? { success: false, error: { message: "registration-token-not-registered" } }
          : { success: true },
      ),
      successCount: tokens.filter((t) => t !== failToken).length,
      failureCount: tokens.filter((t) => t === failToken).length,
    }));

    await handleGoalEvent(makeGoalEvent(team.id));

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);

    const logs = await prisma.notificationLog.findMany({
      where: { notificationId: notifications[0]?.id },
      orderBy: { sentAt: "asc" },
    });
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.status).sort()).toEqual(["FAILED", "SENT"]);
    const failedLog = logs.find((l) => l.status === "FAILED");
    expect(failedLog?.error).toBe("registration-token-not-registered");
  });

  it("nhiều user cùng favorite 1 team -> mỗi user được xử lý độc lập, 1 user lỗi không chặn user khác", async () => {
    const team = await prisma.team.create({ data: { name: "Team Multi", externalRef: ref("team-multi") as object } });
    const userA = await createUser();
    const userB = await createUser();
    await addDevice(userA.id, `token-a-${userA.id}`);
    await addDevice(userB.id, `token-b-${userB.id}`);
    await favoriteTeam(userA.id, team.id);
    await favoriteTeam(userB.id, team.id);

    let call = 0;
    mockSendEachForMulticast.mockImplementation(async ({ tokens }: { tokens: string[] }) => {
      call += 1;
      if (call === 1) throw new Error("FCM tạm lỗi cho user đầu tiên");
      return { responses: tokens.map(() => ({ success: true })), successCount: tokens.length, failureCount: 0 };
    });

    await expect(handleGoalEvent(makeGoalEvent(team.id))).resolves.toBeUndefined();

    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(2); // cả 2 user đều được thử gửi
    const notificationsA = await prisma.notification.findMany({ where: { userId: userA.id } });
    const notificationsB = await prisma.notification.findMany({ where: { userId: userB.id } });
    // Notification (in-app) được ghi TRƯỚC lúc gọi FCM (xem fix 2026-08-24) — nên cả 2 user đều
    // có bản ghi in-app dù 1 trong 2 bị lỗi gửi FCM tạm thời; lỗi đó chỉ mất phần push, không mất
    // lịch sử in-app.
    expect(notificationsA).toHaveLength(1);
    expect(notificationsB).toHaveLength(1);
  });
});
