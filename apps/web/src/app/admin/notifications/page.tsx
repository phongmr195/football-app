"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResourceTable } from "@/components/admin/ResourceTable";
import { apiGetClient, type ApiListResponse } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";

type LogStatus = "SENT" | "FAILED";
type LogChannel = "FCM" | "EMAIL";

interface NotificationLogRow {
  id: string;
  channel: LogChannel;
  status: LogStatus;
  error: string | null;
  sentAt: string;
  notification: {
    id: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    createdAt: string;
  };
}

const ALL_STATUS = "__all__";
const ALL_CHANNEL = "__all__";
const PAGE_SIZE = 20;

// Read-only — tra lịch sử gửi thông báo qua UI thay vì query psql tay (ROADMAP Phase 4). Không có
// create/edit/delete, chỉ filter + pagination.
export default function AdminNotificationLogsPage() {
  const { token } = useAdminAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(ALL_STATUS);
  const [channel, setChannel] = useState(ALL_CHANNEL);
  const [userId, setUserId] = useState("");

  const listQuery = useQuery({
    queryKey: ["admin-notification-logs", page, status, channel, userId],
    queryFn: () =>
      apiGetClient<ApiListResponse<NotificationLogRow>>(
        "/notification-logs",
        {
          page,
          pageSize: PAGE_SIZE,
          status: status === ALL_STATUS ? undefined : status,
          channel: channel === ALL_CHANNEL ? undefined : channel,
          userId: userId || undefined,
        },
        { idToken: token },
      ),
    enabled: !!token,
  });

  const rows = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Nhật ký thông báo</h1>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Lọc theo User ID..."
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onValueChange={(v) => {
            if (!v) return;
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUS}>Mọi trạng thái</SelectItem>
            <SelectItem value="SENT">SENT</SelectItem>
            <SelectItem value="FAILED">FAILED</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={channel}
          onValueChange={(v) => {
            if (!v) return;
            setChannel(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CHANNEL}>Mọi kênh</SelectItem>
            <SelectItem value="FCM">FCM</SelectItem>
            <SelectItem value="EMAIL">EMAIL</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {listQuery.isLoading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Đang tải...</p>
      ) : (
        <>
          <ResourceTable
            columns={[
              { key: "sentAt", label: "Thời gian", render: (row) => new Date(row.sentAt).toLocaleString("vi-VN") },
              { key: "title", label: "Tiêu đề", render: (row) => row.notification.title },
              { key: "userId", label: "User ID", render: (row) => row.notification.userId },
              { key: "channel", label: "Kênh" },
              {
                key: "status",
                label: "Trạng thái",
                render: (row) => (
                  <span className={row.status === "FAILED" ? "text-red-600 dark:text-red-400" : ""}>
                    {row.status}
                  </span>
                ),
              },
              { key: "error", label: "Lỗi", render: (row) => row.error ?? "—" },
            ]}
            rows={rows}
            emptyMessage="Chưa có log nào."
          />
          <div className="flex items-center justify-center gap-4 text-sm">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              ← Trang trước
            </Button>
            <span className="text-zinc-500 dark:text-zinc-400">
              {page} / {totalPages} ({total.toLocaleString("vi-VN")})
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Trang sau →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
