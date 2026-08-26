"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationList,
  useUnreadNotificationCount,
} from "@/lib/use-notifications";
import type { UserNotification } from "@/lib/types";

/** matchId nằm trong `data` của CẢ 2 loại notification hiện có (goal/match_result, xem
 * goal-notifier.ts/match-finished-notifier.ts) — đọc chung 1 chỗ thay vì switch theo `type`. */
function matchIdOf(notification: UserNotification): string | null {
  const value = notification.data?.matchId;
  return typeof value === "string" ? value : null;
}

function NotificationItem({
  notification,
  onRead,
  onClose,
}: {
  notification: UserNotification;
  onRead: (id: string) => void;
  onClose: () => void;
}) {
  const isUnread = notification.readAt === null;
  const matchId = matchIdOf(notification);

  const content = (
    <div
      className={`flex flex-col gap-0.5 rounded-lg px-3 py-2 text-sm ${
        isUnread ? "bg-zinc-50 dark:bg-zinc-800/60" : ""
      } hover:bg-zinc-100 dark:hover:bg-zinc-800`}
    >
      <div className="flex items-center gap-1.5">
        {isUnread ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden="true" /> : null}
        <span className="font-medium text-zinc-900 dark:text-zinc-50">{notification.title}</span>
      </div>
      <p className="text-zinc-600 dark:text-zinc-300">{notification.body}</p>
      <span className="text-xs text-zinc-400 dark:text-zinc-500">
        {new Date(notification.createdAt).toLocaleString("vi-VN")}
      </span>
    </div>
  );

  function handleClick() {
    if (isUnread) onRead(notification.id);
    onClose();
  }

  if (matchId) {
    return (
      <Link href={`/matches/${matchId}`} onClick={handleClick} className="block">
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={handleClick} className="block w-full text-left">
      {content}
    </button>
  );
}

/**
 * Bell icon + dropdown xem thông báo của chính user (goal/match_result push, xem
 * goal-notifier.ts/match-finished-notifier.ts) — đặt cạnh AuthStatus trong NavBar. Ẩn hoàn toàn
 * khi chưa đăng nhập (khác AuthStatus vẫn hiện nút "Đăng nhập" — bell icon không có gì để hiện
 * cho user ẩn danh).
 */
export function NotificationBell() {
  const { user, loading: authLoading } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadCountQuery = useUnreadNotificationCount();
  const listQuery = useNotificationList(open);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (authLoading || !user) return null;

  const unreadCount = unreadCountQuery.data ?? 0;
  const items = listQuery.data?.items ?? [];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        aria-label="Thông báo"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-10 mt-2 w-80 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Thông báo</span>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Đánh dấu tất cả đã đọc
              </button>
            ) : null}
          </div>

          <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {listQuery.isLoading ? (
              <p className="px-3 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">Đang tải...</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Chưa có thông báo nào.
              </p>
            ) : (
              items.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onRead={(id) => markRead.mutate(id)}
                  onClose={() => setOpen(false)}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
