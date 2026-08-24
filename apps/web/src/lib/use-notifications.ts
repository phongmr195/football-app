/**
 * React Query hooks wrapping lib/notifications.ts's fetchers, dùng bởi NotificationBell.tsx
 * (bell icon + dropdown trong NavBar, xem AuthStatus.tsx cho pattern dropdown tương tự).
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth-context";
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications";

const UNREAD_COUNT_KEY = ["notifications", "unread-count"] as const;
const LIST_KEY = ["notifications", "list"] as const;

/** Badge số chưa đọc trên bell icon — poll 30s, cùng cadence tinh thần LiveMatchesTicker's
 * useLiveMatches() (10s) nhưng thưa hơn vì thông báo không cần real-time sát giây như tỉ số live. */
export function useUnreadNotificationCount() {
  const { user, loading: authLoading, getIdToken } = useAuth();

  return useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: async () => fetchUnreadNotificationCount(await getIdToken()),
    enabled: !authLoading && !!user,
    refetchInterval: 30_000,
  });
}

/** Danh sách hiện trong dropdown khi bấm bell icon — chỉ trang 1 (dropdown không có phân trang,
 * xem NotificationBell.tsx), `enabled` thêm điều kiện `open` để không fetch khi dropdown đang đóng. */
export function useNotificationList(open: boolean, pageSize = 10) {
  const { user, loading: authLoading, getIdToken } = useAuth();

  return useQuery({
    queryKey: [...LIST_KEY, pageSize],
    queryFn: async () => fetchNotifications(1, pageSize, await getIdToken()),
    enabled: !authLoading && !!user && open,
  });
}

export function useMarkNotificationRead() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => markNotificationRead(id, await getIdToken()),
    onSuccess: () => {
      // Invalidate thay vì cập nhật cache tay — số lượng item nhỏ (dropdown, không phải list dài),
      // refetch rẻ, tránh phải tự đồng bộ readAt giữa 2 query key (list + unread-count).
      void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => markAllNotificationsRead(await getIdToken()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}
