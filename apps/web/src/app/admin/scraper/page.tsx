"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResourceTable } from "@/components/admin/ResourceTable";
import { ApiError, apiGetClient, apiMutateClient, type ApiListResponse } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";

// 5 giải quốc gia có hỗ trợ Sofascore (soccerdata's LEAGUE_DICT) — Champions League chưa hỗ trợ,
// xem apps/api/src/scraper-competitions.ts. Client chỉ cần key+label — DB name thật (vd La Liga ->
// "Primera Division") và mapping Sofascore chỉ apps/api biết, tra qua GET /admin/scraper-competitions.
const COMPETITION_OPTIONS = [
  { key: "premier-league", label: "Premier League" },
  { key: "la-liga", label: "La Liga" },
  { key: "bundesliga", label: "Bundesliga" },
  { key: "serie-a", label: "Serie A" },
  { key: "ligue-1", label: "Ligue 1" },
];

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 10;
const MAX_LIMIT = 100;
const PAGE_SIZE = 20;

type ScraperRunStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

interface ScraperCompetitionOption {
  key: string;
  label: string;
  competitionId: string | null;
  seasons: { id: string; name: string; isCurrent: boolean }[];
}

interface IngestSummary {
  processedFiles: number;
  eventsCreated: number;
  lineupsUpserted: number;
  ratingsUpserted: number;
  statisticsUpserted: number;
  unmatchedPlayers: string[];
}

interface ScraperRunRow {
  id: string;
  status: ScraperRunStatus;
  requestedLimit: number;
  matchesFound: number | null;
  matchesScraped: number | null;
  ingestSummary: IngestSummary | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  competition: { id: string; name: string };
  season: { id: string; name: string };
}

const STATUS_BADGE_VARIANT: Record<ScraperRunStatus, "outline" | "default" | "destructive"> = {
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

/**
 * Trang admin trigger pipeline scrape Sofascore (trước đó chỉ chạy tay 3 bước CLI, xem
 * apps/scraper-sofascore) — chọn giải/mùa/limit, "Áp dụng" gọi POST /admin/scraper-runs
 * (apps/api spawn subprocess, không block response), rồi poll GET /admin/scraper-runs/:id mỗi 5s
 * trong lúc PENDING/RUNNING, đúng pattern use-live-match.ts's refetchInterval.
 */
export default function AdminScraperPage() {
  const { token } = useAdminAuth();
  const queryClient = useQueryClient();
  const [competitionKey, setCompetitionKey] = useState<string>(COMPETITION_OPTIONS[0]!.key);
  const [seasonId, setSeasonId] = useState<string>("");
  const [limit, setLimit] = useState(String(DEFAULT_LIMIT));
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  const competitionsQuery = useQuery({
    queryKey: ["admin-scraper-competitions"],
    queryFn: () =>
      apiGetClient<{ items: ScraperCompetitionOption[] }>("/admin/scraper-competitions", undefined, { idToken: token }),
    enabled: !!token,
  });
  const seasons = competitionsQuery.data?.items.find((c) => c.key === competitionKey)?.seasons ?? [];

  const activeRunQuery = useQuery({
    queryKey: ["admin-scraper-run", activeRunId],
    queryFn: () => apiGetClient<ScraperRunRow>(`/admin/scraper-runs/${activeRunId}`, undefined, { idToken: token }),
    enabled: !!token && !!activeRunId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "RUNNING" || status === "PENDING" ? 5000 : false;
    },
    refetchIntervalInBackground: false,
  });

  // Bump lịch sử đúng 1 lần khi run vừa chuyển sang SUCCESS/FAILED — setState ngay trong lúc render
  // (KHÔNG dùng ref — bị chặn bởi react-hooks/refs lint rule), có guard so sánh để chỉ chạy khi
  // thực sự có thay đổi, đúng pattern "adjust state during render" đã dùng ở LiveMatchPanel.tsx.
  const [invalidatedRunId, setInvalidatedRunId] = useState<string | null>(null);
  const isRunFinished = activeRunQuery.data?.status === "SUCCESS" || activeRunQuery.data?.status === "FAILED";
  if (isRunFinished && activeRunId && invalidatedRunId !== activeRunId) {
    setInvalidatedRunId(activeRunId);
    void queryClient.invalidateQueries({ queryKey: ["admin-scraper-runs"] });
  }

  const historyQuery = useQuery({
    queryKey: ["admin-scraper-runs", historyPage],
    queryFn: () =>
      apiGetClient<ApiListResponse<ScraperRunRow>>(
        "/admin/scraper-runs",
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
    const limitNum = Number(limit);
    if (!seasonId) {
      setSubmitError("Chọn mùa giải trước khi áp dụng.");
      return;
    }
    setSubmitting(true);
    try {
      const run = await apiMutateClient<ScraperRunRow>(
        "/admin/scraper-runs",
        "POST",
        { competitionKey, seasonId, limit: limitNum },
        { idToken: token },
      );
      setActiveRunId(run.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSubmitError("Đang có 1 lượt scrape khác chạy — chờ xong rồi thử lại.");
      } else {
        setSubmitError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const run = activeRunQuery.data;
  const isBusy = run?.status === "PENDING" || run?.status === "RUNNING";

  // Đếm giây trôi qua kể từ startedAt (PENDING chưa có startedAt — dùng createdAt tạm thay) — tick
  // mỗi giây bằng setInterval ở client, KHÔNG phải dữ liệu từ server (server chỉ trả startedAt 1
  // lần, không tự cập nhật liên tục giữa 2 lần poll 5s).
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
        <Download className="h-6 w-6" aria-hidden="true" />
        Scraper dữ liệu
      </h1>

      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scraper-competition">Giải đấu</Label>
            <Select
              value={competitionKey}
              onValueChange={(v) => {
                if (!v) return;
                setCompetitionKey(v);
                setSeasonId("");
              }}
            >
              <SelectTrigger id="scraper-competition" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPETITION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.key} value={opt.key}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scraper-season">Mùa giải</Label>
            <Select value={seasonId} onValueChange={(v) => v && setSeasonId(v)}>
              <SelectTrigger id="scraper-season" className="w-40">
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scraper-limit">Số trận (10-100)</Label>
            <Input
              id="scraper-limit"
              type="number"
              min={MIN_LIMIT}
              max={MAX_LIMIT}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-28"
            />
          </div>

          <Button onClick={() => void handleApply()} disabled={submitting || isBusy}>
            {submitting ? "Đang bắt đầu..." : "Apply"}
          </Button>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Mùa giải &ldquo;hiện tại&rdquo; thường CHƯA có trận đấu xong — mùa đã kết thúc (không đánh
          dấu hiện tại) mới thường có trận cần scrape.
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
                <span>Đang xử lý thêm dữ liệu, xin vui lòng đợi...</span>
              </div>
            ) : null}
            {run.matchesFound !== null ? <span>Tìm thấy {run.matchesFound} trận cần scrape.</span> : null}
            {run.matchesScraped !== null ? <span>Đã scrape được {run.matchesScraped} trận.</span> : null}
            {run.errorMessage ? <span className="text-red-600 dark:text-red-400">{run.errorMessage}</span> : null}
            {run.ingestSummary ? (
              <span>
                Đã ghi: {run.ingestSummary.eventsCreated} event, {run.ingestSummary.lineupsUpserted} lineup,{" "}
                {run.ingestSummary.ratingsUpserted} rating, {run.ingestSummary.statisticsUpserted} statistic
                {run.ingestSummary.unmatchedPlayers.length > 0
                  ? ` (${run.ingestSummary.unmatchedPlayers.length} cầu thủ không khớp được)`
                  : ""}
                .
              </span>
            ) : null}
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
                { key: "createdAt", label: "Thời gian", render: (row) => new Date(row.createdAt).toLocaleString("vi-VN") },
                { key: "competition", label: "Giải đấu", render: (row) => row.competition.name },
                { key: "season", label: "Mùa", render: (row) => row.season.name },
                { key: "requestedLimit", label: "Limit" },
                {
                  key: "status",
                  label: "Trạng thái",
                  render: (row) => <Badge variant={STATUS_BADGE_VARIANT[row.status]}>{row.status}</Badge>,
                },
                {
                  key: "result",
                  label: "Kết quả",
                  render: (row) =>
                    row.ingestSummary
                      ? `${row.ingestSummary.eventsCreated} event, ${row.ingestSummary.lineupsUpserted} lineup`
                      : row.errorMessage ?? "—",
                },
              ]}
              rows={historyRows}
              emptyMessage="Chưa có lượt scrape nào."
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
