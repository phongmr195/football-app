"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResourceTable } from "@/components/admin/ResourceTable";
import { apiGetClient, type ApiListResponse } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";

type LogService = "API" | "SYNC_WORKER";
type LogLevel = "WARN" | "ERROR";

interface SystemLogRow {
  id: string;
  service: LogService;
  level: LogLevel;
  message: string;
  detail: unknown;
  createdAt: string;
}

const ALL_SERVICE = "__all__";
const ALL_LEVEL = "__all__";
const PAGE_SIZE = 30;

/** vd { message: "...", stack: "..." } (Error) hoặc { value: "..." } (non-Error) — xem toDetail()
 * trong apps/api/src/logger.ts + apps/sync-worker/src/logger.ts. Bản rút gọn 1 dòng cho cell. */
function formatDetailSummary(detail: unknown): string {
  if (detail === null || detail === undefined) return "—";
  if (typeof detail === "object" && "message" in detail) {
    return String((detail as { message: unknown }).message);
  }
  if (typeof detail === "object" && "value" in detail) {
    return String((detail as { value: unknown }).value);
  }
  return JSON.stringify(detail);
}

/** Bản đầy đủ cho popup — giữ nguyên `stack` (formatDetailSummary bỏ qua trường này vì quá dài
 * cho 1 dòng cell). */
function formatDetailFull(detail: unknown): string {
  if (detail === null || detail === undefined) return "—";
  if (typeof detail === "object" && "stack" in detail) {
    return String((detail as { stack: unknown }).stack);
  }
  if (typeof detail === "object" && "value" in detail) {
    return String((detail as { value: unknown }).value);
  }
  return JSON.stringify(detail, null, 2);
}

/** Cột "Chi tiết" — width cố định (xem className="w-72" ở cột tương ứng + ResourceTable's
 * fixedLayout), text 1 dòng bị cắt (truncate) kèm nút "Xem thêm" mở popup xem đầy đủ (message +
 * stack/JSON) — khác TruncatedListCell (admin/scraper/page.tsx, tự expand ngay trong cell) vì
 * detail ở đây có thể dài tới hàng nghìn ký tự (stack trace), không hợp để giãn cả hàng của bảng. */
function DetailCell({ message, detail }: { message: string; detail: unknown }) {
  const summary = formatDetailSummary(detail);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{summary}</span>
      {summary !== "—" ? (
        <Dialog>
          <DialogTrigger className="shrink-0 text-xs text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            Xem thêm
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Chi tiết log</DialogTitle>
            </DialogHeader>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{message}</p>
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-zinc-100 p-3 text-xs whitespace-pre-wrap text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {formatDetailFull(detail)}
            </pre>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

// Read-only — chỉ ERROR/WARN từ apps/api + apps/sync-worker (2 service dài hạn duy nhất), xem
// model SystemLog trong schema.prisma. Không có create/edit/delete, chỉ filter + pagination.
export default function AdminSystemLogsPage() {
  const { token } = useAdminAuth();
  const [page, setPage] = useState(1);
  const [service, setService] = useState(ALL_SERVICE);
  const [level, setLevel] = useState(ALL_LEVEL);

  const listQuery = useQuery({
    queryKey: ["admin-system-logs", page, service, level],
    queryFn: () =>
      apiGetClient<ApiListResponse<SystemLogRow>>(
        "/admin/system-logs",
        {
          page,
          pageSize: PAGE_SIZE,
          service: service === ALL_SERVICE ? undefined : service,
          level: level === ALL_LEVEL ? undefined : level,
        },
        { idToken: token },
      ),
    enabled: !!token,
    // Log lỗi có thể xuất hiện bất cứ lúc nào (sync-worker-live chạy 24/7) — tự refetch để trang
    // không cần F5 tay mới thấy log mới, cùng cadence LiveMatchesTicker's useLiveMatches().
    refetchInterval: 10_000,
  });

  const rows = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        <ScrollText className="h-6 w-6" aria-hidden="true" />
        System logs
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Chỉ lỗi/warning quan trọng từ apps/api và sync-worker (không phải toàn bộ console.log) —
        các catch-block &quot;fire-and-forget&quot; trước đây chỉ in ra stdout/stderr, không lưu lại được.
        Log cũ hơn 30 ngày tự động bị xoá mỗi khi có log mới được ghi.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={service}
          onValueChange={(v) => {
            if (!v) return;
            setService(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SERVICE}>Mọi service</SelectItem>
            <SelectItem value="API">API</SelectItem>
            <SelectItem value="SYNC_WORKER">Sync worker</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={level}
          onValueChange={(v) => {
            if (!v) return;
            setLevel(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_LEVEL}>Mọi mức</SelectItem>
            <SelectItem value="ERROR">ERROR</SelectItem>
            <SelectItem value="WARN">WARN</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {listQuery.isLoading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Đang tải...</p>
      ) : (
        <>
          <ResourceTable
            fixedLayout
            columns={[
              {
                key: "createdAt",
                label: "Thời gian",
                className: "w-36",
                render: (row) => new Date(row.createdAt).toLocaleString("vi-VN"),
              },
              { key: "service", label: "Service", className: "w-28" },
              {
                key: "level",
                label: "Mức",
                className: "w-20",
                render: (row) => (
                  <span className={row.level === "ERROR" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}>
                    {row.level}
                  </span>
                ),
              },
              {
                key: "message",
                label: "Message",
                className: "w-72",
                render: (row) => <span className="block truncate">{row.message}</span>,
              },
              {
                key: "detail",
                label: "Chi tiết",
                className: "w-72",
                render: (row) => <DetailCell message={row.message} detail={row.detail} />,
              },
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
