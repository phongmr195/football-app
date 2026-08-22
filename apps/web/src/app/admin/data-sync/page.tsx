"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResourceTable } from "@/components/admin/ResourceTable";
import { ApiError, apiGetClient, apiMutateClient, type ApiListResponse } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";

// 6 giải lớn được phép đồng bộ tay (xem apps/api/src/sync-competitions.ts's SYNC_COMPETITIONS) —
// KHÔNG cho chọn tự do từ toàn bộ Competition trong DB (189 dòng thật, đa số chỉ có metadata do
// syncCompetitions() từng fetch toàn bộ /competitions của football-data.org, không phải 13 giải
// free-tier có data thật — xem CLAUDE.md § Data provider).
const PAGE_SIZE = 20;

type SyncRunStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

interface SyncCompetitionOption {
  key: string;
  label: string;
  competitionId: string | null;
  seasons: { id: string; name: string; isCurrent: boolean }[];
}

interface SyncResultSummary {
  teams: number;
  players: number;
  standings: number;
  matches: number;
  topScorers: number;
  teamAggregates: number;
}

interface SyncRunRow {
  id: string;
  status: SyncRunStatus;
  resultSummary: SyncResultSummary | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  competition: { id: string; name: string };
  season: { id: string; name: string };
}

const STATUS_BADGE_VARIANT: Record<SyncRunStatus, "outline" | "default" | "destructive"> = {
  PENDING: "outline",
  RUNNING: "outline",
  SUCCESS: "default",
  FAILED: "destructive",
};

function formatElapsedSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatResultSummary(summary: SyncResultSummary): string {
  return [
    [summary.teams, "team"],
    [summary.players, "player"],
    [summary.standings, "standing"],
    [summary.matches, "match"],
    [summary.topScorers, "top scorer"],
    [summary.teamAggregates, "team aggregate"],
  ]
    .filter(([count]) => (count as number) > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(", ") || "không có gì mới";
}

/**
 * Trang admin trigger đồng bộ danh mục football-data.org (teams/players/standings/matches/
 * topScorers) cho 1 competition+season ĐÃ có trong DB — trước đó chỉ chạy tay qua CLI
 * (SYNC_MODE=catalog, xem apps/sync-worker/src/sync-all.ts). Chỉ re-sync giải/mùa đã tồn tại,
 * KHÔNG discover giải mới (đó vẫn phải chạy tay syncCompetitions() — ngoài scope trang này).
 * Cùng shape trigger-and-poll với /admin/scraper (apps/api spawn subprocess, không block
 * response, poll GET /admin/sync-runs/:id mỗi 5s trong lúc PENDING/RUNNING).
 */
export default function AdminDataSyncPage() {
  const { token } = useAdminAuth();
  const queryClient = useQueryClient();
  const [competitionKey, setCompetitionKey] = useState<string>("");
  const [seasonId, setSeasonId] = useState<string>("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  const competitionsQuery = useQuery({
    queryKey: ["admin-data-sync-competitions"],
    queryFn: () =>
      apiGetClient<{ items: SyncCompetitionOption[] }>("/admin/sync-competitions", undefined, { idToken: token }),
    enabled: !!token,
  });
  const competitionOptions = competitionsQuery.data?.items ?? [];
  // Chọn giải đầu tiên có sẵn khi list load xong, nếu chưa chọn gì — tránh state "" mãi (Select
  // không hiện placeholder đẹp khi options đã có nhưng value rỗng).
  if (!competitionKey && competitionOptions.length > 0) {
    setCompetitionKey(competitionOptions[0]!.key);
  }
  const seasons = competitionOptions.find((c) => c.key === competitionKey)?.seasons ?? [];

  const activeRunQuery = useQuery({
    queryKey: ["admin-data-sync-run", activeRunId],
    queryFn: () => apiGetClient<SyncRunRow>(`/admin/sync-runs/${activeRunId}`, undefined, { idToken: token }),
    enabled: !!token && !!activeRunId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "RUNNING" || status === "PENDING" ? 5000 : false;
    },
    refetchIntervalInBackground: false,
  });

  // Bump lịch sử đúng 1 lần khi run vừa chuyển sang SUCCESS/FAILED — cùng pattern
  // admin/scraper/page.tsx (setState ngay trong lúc render, có guard tránh lặp vô hạn).
  const [invalidatedRunId, setInvalidatedRunId] = useState<string | null>(null);
  const isRunFinished = activeRunQuery.data?.status === "SUCCESS" || activeRunQuery.data?.status === "FAILED";
  if (isRunFinished && activeRunId && invalidatedRunId !== activeRunId) {
    setInvalidatedRunId(activeRunId);
    void queryClient.invalidateQueries({ queryKey: ["admin-data-sync-runs"] });
  }

  const historyQuery = useQuery({
    queryKey: ["admin-data-sync-runs", historyPage],
    queryFn: () =>
      apiGetClient<ApiListResponse<SyncRunRow>>(
        "/admin/sync-runs",
        { page: historyPage, pageSize: PAGE_SIZE },
        { idToken: token },
      ),
    enabled: !!token,
  });
  const historyRows = historyQuery.data?.items ?? [];
  const historyTotal = historyQuery.data?.total ?? 0;
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / PAGE_SIZE));

  async function handleApply() {
    setSubmitError(null);
    if (!competitionKey || !seasonId) {
      setSubmitError("Chọn giải đấu và mùa giải trước khi đồng bộ.");
      return;
    }
    setSubmitting(true);
    try {
      const run = await apiMutateClient<SyncRunRow>(
        "/admin/sync-runs",
        "POST",
        { competitionKey, seasonId },
        { idToken: token },
      );
      setActiveRunId(run.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSubmitError("Đang có 1 lượt đồng bộ khác chạy — chờ xong rồi thử lại.");
      } else {
        setSubmitError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const run = activeRunQuery.data;
  const isBusy = run?.status === "PENDING" || run?.status === "RUNNING";

  // Đếm giây trôi qua kể từ startedAt — tick mỗi giây ở client, cùng pattern admin/scraper/page.tsx.
  const runStartTimestamp = run?.startedAt ?? run?.createdAt ?? null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!isBusy || !runStartTimestamp) return;
    const startMs = new Date(runStartTimestamp).getTime();
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isBusy, runStartTimestamp]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        <RefreshCw className="h-6 w-6" aria-hidden="true" />
        Đồng bộ dữ liệu
      </h1>

      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sync-competition">Giải đấu</Label>
            <Select
              value={competitionKey}
              onValueChange={(v) => {
                if (!v) return;
                setCompetitionKey(v);
                setSeasonId("");
              }}
            >
              <SelectTrigger id="sync-competition" className="w-56">
                <SelectValue placeholder="Chọn giải" />
              </SelectTrigger>
              <SelectContent>
                {competitionOptions.map((comp) => (
                  <SelectItem key={comp.key} value={comp.key}>
                    {comp.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sync-season">Mùa giải</Label>
            <Select value={seasonId} onValueChange={(v) => v && setSeasonId(v)}>
              <SelectTrigger id="sync-season" className="w-40" disabled={!competitionKey}>
                <SelectValue placeholder="Chọn mùa" />
              </SelectTrigger>
              <SelectContent>
                {seasons.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} {s.isCurrent ? "(hiện tại)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={() => void handleApply()} disabled={submitting || isBusy}>
            {submitting ? "Đang bắt đầu..." : "Đồng bộ ngay"}
          </Button>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Đồng bộ lại toàn bộ team/player/standing/match/top scorer cho đúng giải + mùa đã chọn từ
          football-data.org — chỉ áp dụng cho giải/mùa ĐÃ có trong DB, không phát hiện giải mới.
        </p>

        {submitError ? <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p> : null}

        {run ? (
          <div className="mt-2 flex flex-col gap-1 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
            <div className="flex items-center gap-2">
              <span className="font-medium">Lượt chạy hiện tại:</span>
              <Badge variant={STATUS_BADGE_VARIANT[run.status]}>{run.status}</Badge>
              {isBusy ? (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{formatElapsedSeconds(elapsedSeconds)}</span>
              ) : null}
            </div>
            {isBusy ? (
              <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Đang đồng bộ, xin vui lòng đợi (có thể mất vài phút)...</span>
              </div>
            ) : null}
            {run.errorMessage ? <span className="text-red-600 dark:text-red-400">{run.errorMessage}</span> : null}
            {run.resultSummary ? <span>Đã ghi: {formatResultSummary(run.resultSummary)}.</span> : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Lịch sử</h2>
        {historyQuery.isLoading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Đang tải...</p>
        ) : (
          <>
            <ResourceTable
              columns={[
                {
                  key: "createdAt",
                  label: "Thời gian",
                  render: (row) => new Date(row.createdAt).toLocaleString("vi-VN"),
                },
                { key: "competition", label: "Giải đấu", render: (row) => row.competition.name },
                { key: "season", label: "Mùa", render: (row) => row.season.name },
                {
                  key: "status",
                  label: "Trạng thái",
                  render: (row) => <Badge variant={STATUS_BADGE_VARIANT[row.status]}>{row.status}</Badge>,
                },
                {
                  key: "result",
                  label: "Kết quả",
                  render: (row) => (row.resultSummary ? formatResultSummary(row.resultSummary) : row.errorMessage ?? "—"),
                },
              ]}
              rows={historyRows}
              emptyMessage="Chưa có lượt đồng bộ nào."
            />
            <div className="flex items-center justify-center gap-4 text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={historyPage <= 1}
                onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
              >
                ← Trang trước
              </Button>
              <span className="text-zinc-500 dark:text-zinc-400">
                {historyPage} / {historyTotalPages} ({historyTotal.toLocaleString("vi-VN")})
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={historyPage >= historyTotalPages}
                onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
              >
                Trang sau →
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
