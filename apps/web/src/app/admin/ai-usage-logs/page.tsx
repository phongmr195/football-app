"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/admin/Combobox";
import { Label } from "@/components/ui/label";
import { ResourceTable } from "@/components/admin/ResourceTable";
import { apiGetClient, type ApiListResponse } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";

interface AiUsageLogRow {
  id: string;
  userId: string;
  feature: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  createdAt: string;
  user: { id: string; email: string | null };
}

interface AiUsageLogsResponse extends ApiListResponse<AiUsageLogRow> {
  summary: { tokensInput: number; tokensOutput: number; costUsd: number };
}

interface UsageLogUser {
  id: string;
  email: string | null;
}

const ALL_FEATURE = "__all__";
const ALL_USER = "__all__";
const PAGE_SIZE = 20;

function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}

// Filter theo email cục bộ (client-side) — danh sách feature/user bị chặn bởi chính bảng
// ai_usage_logs (chỉ 2 feature, số user dùng AI thật hiện còn nhỏ), không đáng làm search server-side
// riêng cho Combobox chỉ vì vài chục dòng. Nếu số user tăng nhiều, đổi qua search server-side sau
// (thêm query param cho /ai-usage-logs/users), không phải quyết định kiến trúc lớn ngay bây giờ.
function filterByLabel<T extends { label: string }>(options: T[], search: string): T[] {
  const query = search.trim().toLowerCase();
  if (!query) return options;
  return options.filter((o) => o.label.toLowerCase().includes(query));
}

// Read-only — tra chi phí/lượt dùng AI (chat, player_compare — cap theo user qua AiUsageLog, xem
// CLAUDE.md § AI) qua UI thay vì query psql tay, cùng convention /admin/notifications. Không có
// create/edit/delete, chỉ filter + pagination + tổng theo filter đang áp dụng.
export default function AdminAiUsageLogsPage() {
  const { token } = useAdminAuth();
  const [page, setPage] = useState(1);
  const [feature, setFeature] = useState(ALL_FEATURE);
  const [featureSearch, setFeatureSearch] = useState("");
  const [userId, setUserId] = useState(ALL_USER);
  const [userSearch, setUserSearch] = useState("");

  const featuresQuery = useQuery({
    queryKey: ["admin-ai-usage-log-features"],
    queryFn: () => apiGetClient<{ items: string[] }>("/ai-usage-logs/features", undefined, { idToken: token }),
    enabled: !!token,
  });

  const usersQuery = useQuery({
    queryKey: ["admin-ai-usage-log-users"],
    queryFn: () => apiGetClient<{ items: UsageLogUser[] }>("/ai-usage-logs/users", undefined, { idToken: token }),
    enabled: !!token,
  });

  const listQuery = useQuery({
    queryKey: ["admin-ai-usage-logs", page, feature, userId],
    queryFn: () =>
      apiGetClient<AiUsageLogsResponse>(
        "/ai-usage-logs",
        {
          page,
          pageSize: PAGE_SIZE,
          feature: feature === ALL_FEATURE ? undefined : feature,
          userId: userId === ALL_USER ? undefined : userId,
        },
        { idToken: token },
      ),
    enabled: !!token,
  });

  const rows = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const summary = listQuery.data?.summary;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const featureOptions = filterByLabel(
    [{ id: ALL_FEATURE, label: "Mọi feature" }, ...(featuresQuery.data?.items ?? []).map((f) => ({ id: f, label: f }))],
    featureSearch,
  );
  const userOptions = filterByLabel(
    [
      { id: ALL_USER, label: "Mọi user" },
      ...(usersQuery.data?.items ?? []).map((u) => ({ id: u.id, label: u.email ?? u.id })),
    ],
    userSearch,
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        <Coins className="h-6 w-6" aria-hidden="true" />
        Nhật ký sử dụng AI
      </h1>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label>User</Label>
          <Combobox
            value={userId}
            onChange={(value) => {
              setUserId(value || ALL_USER);
              setPage(1);
            }}
            options={userOptions}
            search={userSearch}
            onSearchChange={setUserSearch}
            loading={usersQuery.isLoading}
            placeholder="Chọn user"
            searchPlaceholder="Tìm theo email..."
            className="w-64"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Feature</Label>
          <Combobox
            value={feature}
            onChange={(value) => {
              setFeature(value || ALL_FEATURE);
              setPage(1);
            }}
            options={featureOptions}
            search={featureSearch}
            onSearchChange={setFeatureSearch}
            loading={featuresQuery.isLoading}
            placeholder="Chọn feature"
            searchPlaceholder="Tìm feature..."
            className="w-48"
          />
        </div>
      </div>

      {summary ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-zinc-500 dark:text-zinc-400">
              Tổng theo bộ lọc đang áp dụng ({total.toLocaleString("vi-VN")} lượt)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Tokens input</p>
              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {summary.tokensInput.toLocaleString("vi-VN")}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Tokens output</p>
              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {summary.tokensOutput.toLocaleString("vi-VN")}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Chi phí ước tính</p>
              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{formatCost(summary.costUsd)}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {listQuery.isLoading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Đang tải...</p>
      ) : (
        <>
          <ResourceTable
            columns={[
              { key: "createdAt", label: "Thời gian", render: (row) => new Date(row.createdAt).toLocaleString("vi-VN") },
              { key: "feature", label: "Feature" },
              { key: "userId", label: "User", render: (row) => row.user.email ?? row.userId },
              { key: "tokensInput", label: "Tokens in", render: (row) => row.tokensInput.toLocaleString("vi-VN") },
              { key: "tokensOutput", label: "Tokens out", render: (row) => row.tokensOutput.toLocaleString("vi-VN") },
              { key: "costUsd", label: "Chi phí", render: (row) => formatCost(row.costUsd) },
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
