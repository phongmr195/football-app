/**
 * Thin fetchers cho apps/api's `/notifications/*` (thông báo CỦA CHÍNH user đang đăng nhập) —
 * cùng convention lib/favorites.ts: nhận `idToken` qua tham số (caller tự lấy qua
 * `useAuth().getIdToken()` ngay trước khi gọi), không cache token ở đây.
 */
import { apiGetClient, apiMutateClient, type ApiListResponse } from "./api-client";
import type { UserNotification } from "./types";

export async function fetchNotifications(
  page: number,
  pageSize: number,
  idToken: string | null,
): Promise<ApiListResponse<UserNotification>> {
  return apiGetClient<ApiListResponse<UserNotification>>(
    "/notifications",
    { page, pageSize },
    { idToken },
  );
}

export async function fetchUnreadNotificationCount(idToken: string | null): Promise<number> {
  const { count } = await apiGetClient<{ count: number }>(
    "/notifications/unread-count",
    undefined,
    { idToken },
  );
  return count;
}

export async function markNotificationRead(id: string, idToken: string | null): Promise<void> {
  await apiMutateClient(`/notifications/${id}/read`, "PATCH", undefined, { idToken });
}

export async function markAllNotificationsRead(idToken: string | null): Promise<void> {
  await apiMutateClient("/notifications/read-all", "PATCH", undefined, { idToken });
}
