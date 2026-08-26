"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Coins,
  Download,
  LayoutDashboard,
  RefreshCw,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { apiGetClient } from "@/lib/api-client";

type RunStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

interface DashboardSummary {
  catalog: { competitions: number; seasons: number; teams: number; players: number; matches: number };
  matches: { live: number; today: number; finishedToday: number };
  users: { total: number; favoriteTeams: number; favoritePlayers: number; withDevice: number };
  aiUsage30d: { costUsd: number; requestCount: number };
  systemHealth24h: { errors: number; warnings: number };
  notifications24h: { sent: number; failed: number };
  latestScraperRun: { status: RunStatus; competitionName: string; seasonName: string; finishedAt: string | null } | null;
  latestSyncRun: { status: RunStatus; competitionName: string; seasonName: string; finishedAt: string | null } | null;
}

const RUN_STATUS_VARIANT: Record<RunStatus, "outline" | "default" | "destructive"> = {
  PENDING: "outline",
  RUNNING: "outline",
  SUCCESS: "default",
  FAILED: "destructive",
};

function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}

/** 1 số + nhãn, bấm vào điều hướng tới trang quản lý tương ứng — dùng cho hàng "danh mục" (catalog
 * counts), khối đơn giản nhất trong dashboard. */
function CatalogStat({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <Link href={href} className="block">
      <Card className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
        <CardContent className="flex flex-col gap-1">
          <span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {value.toLocaleString("vi-VN")}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Tổng quan hệ thống — trước đây chỉ có lời chào trống, admin phải tự vào từng trang con mới biết
 * tình hình. Toàn bộ số liệu đọc từ GET /admin/dashboard-summary (apps/api/src/routes/
 * admin-dashboard.ts) — 1 request, không thêm bảng/model nào, chỉ tổng hợp dữ liệu đã có sẵn từ
 * các feature trước (SystemLog, NotificationLog, AiUsageLog, ScraperRun, SyncRun...).
 */
export default function AdminDashboardPage() {
  const { adminUser, token } = useAdminAuth();

  const summaryQuery = useQuery({
    queryKey: ["admin-dashboard-summary"],
    queryFn: () => apiGetClient<DashboardSummary>("/admin/dashboard-summary", undefined, { idToken: token }),
    enabled: !!token,
    // Số liệu (đặc biệt "đang live"/sức khoẻ hệ thống) có thể đổi bất cứ lúc nào — cùng cadence
    // LiveMatchesTicker's useLiveMatches() (10s) vì đây cũng là trang admin hay để mở theo dõi.
    refetchInterval: 10_000,
  });

  const data = summaryQuery.data;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        <LayoutDashboard className="h-6 w-6" aria-hidden="true" />
        Dashboard
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Xin chào, {adminUser?.username}.</p>

      {summaryQuery.isLoading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Đang tải...</p>
      ) : !data ? (
        <p className="text-sm text-red-600 dark:text-red-400">Không tải được số liệu, thử lại sau.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <CatalogStat href="/admin/competitions" label="Giải đấu" value={data.catalog.competitions} />
            <CatalogStat href="/admin/seasons" label="Mùa giải" value={data.catalog.seasons} />
            <CatalogStat href="/admin/teams" label="Đội bóng" value={data.catalog.teams} />
            <CatalogStat href="/admin/players" label="Cầu thủ" value={data.catalog.players} />
            <CatalogStat href="/admin/matches" label="Trận đấu" value={data.catalog.matches} />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Link href="/admin/matches" className="block">
              <Card className="h-full transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                    <CalendarClock className="h-4 w-4" aria-hidden="true" />
                    Trận đấu
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Đang live</p>
                    <p
                      className={`text-lg font-semibold ${
                        data.matches.live > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-zinc-900 dark:text-zinc-50"
                      }`}
                    >
                      {data.matches.live}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Hôm nay</p>
                    <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      {data.matches.today}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Đã xong (nay)</p>
                    <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      {data.matches.finishedToday}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Người dùng
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Tổng số</p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{data.users.total}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Yêu thích</p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    {data.users.favoriteTeams + data.users.favoritePlayers}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Đã bật push</p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    {data.users.withDevice}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Link href="/admin/ai-usage-logs" className="block">
              <Card className="h-full transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                    <Coins className="h-4 w-4" aria-hidden="true" />
                    Sử dụng AI (30 ngày)
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Chi phí ước tính</p>
                    <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      {formatCost(data.aiUsage30d.costUsd)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Số lượt gọi</p>
                    <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      {data.aiUsage30d.requestCount}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Link href="/admin/system-logs" className="block">
              <Card className="h-full transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    Sức khoẻ hệ thống (24h)
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Lỗi (ERROR)</p>
                    <p
                      className={`text-lg font-semibold ${
                        data.systemHealth24h.errors > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-zinc-900 dark:text-zinc-50"
                      }`}
                    >
                      {data.systemHealth24h.errors}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Cảnh báo (WARN)</p>
                    <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      {data.systemHealth24h.warnings}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Link href="/admin/notifications" className="block">
              <Card className="h-full transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                    <Bell className="h-4 w-4" aria-hidden="true" />
                    Thông báo (24h)
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Đã gửi</p>
                    <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      {data.notifications24h.sent}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Thất bại</p>
                    <p
                      className={`text-lg font-semibold ${
                        data.notifications24h.failed > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-zinc-900 dark:text-zinc-50"
                      }`}
                    >
                      {data.notifications24h.failed}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Lần chạy gần nhất
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-xs">
                <Link href="/admin/scraper" className="flex items-center justify-between gap-2 hover:underline">
                  <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Scraper
                  </span>
                  {data.latestScraperRun ? (
                    <Badge variant={RUN_STATUS_VARIANT[data.latestScraperRun.status]}>
                      {data.latestScraperRun.status}
                    </Badge>
                  ) : (
                    <span className="text-zinc-400 dark:text-zinc-500">—</span>
                  )}
                </Link>
                <Link href="/admin/data-sync" className="flex items-center justify-between gap-2 hover:underline">
                  <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Sync dữ liệu
                  </span>
                  {data.latestSyncRun ? (
                    <Badge variant={RUN_STATUS_VARIANT[data.latestSyncRun.status]}>
                      {data.latestSyncRun.status}
                    </Badge>
                  ) : (
                    <span className="text-zinc-400 dark:text-zinc-500">—</span>
                  )}
                </Link>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
