"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

// 9 loại data MATCH-LEVEL khớp SCRAPER_DATA_TYPES (apps/api/src/scraper-competitions.ts) —
// duplicate label ở đây thay vì gọi thêm 1 endpoint riêng, cùng convention COMPETITION_OPTIONS
// phía trên. KHÔNG gồm "playerSeasonStats" — loại đó SEASON-level (1 lần fetch/mùa, không theo
// từng trận, không cần Limit) nên tách hẳn thành tab riêng bên dưới, không lẫn vào checkbox list
// này (tránh admin tưởng nó cũng theo Limit/theo trận như 9 loại còn lại).
const DATA_TYPE_OPTIONS = [
  { key: "events", label: "Events (diễn biến)" },
  { key: "lineups", label: "Lineups + Ratings (đội hình)" },
  { key: "statistics", label: "Statistics (thống kê trận)" },
  { key: "commentary", label: "Commentary (bình luận theo phút)" },
  { key: "shotmap", label: "Shotmap (bản đồ cú sút, xG)" },
  { key: "highlights", label: "Highlights (link video)" },
  { key: "averagePositions", label: "Average positions (vị trí trung bình)" },
  { key: "momentum", label: "Momentum graph (biểu đồ áp lực trận)" },
  { key: "odds", label: "Odds (tỉ lệ cược — admin-only)" },
];
const DEFAULT_DATA_TYPES = ["events", "lineups", "statistics", "shotmap", "highlights", "averagePositions", "momentum"];

// Season-level, tab riêng — xem SCRAPER_DATA_TYPES's playerSeasonStats + scraper-orchestrator.ts's
// runPlayerSeasonStatsPipeline(). Backend vẫn yêu cầu `limit` (Zod schema chung cho mọi
// dataTypes) nhưng loại này KHÔNG dùng tới giá trị này — gửi hằng số cố định, không hỏi admin.
const PLAYER_SEASON_STATS_KEY = "playerSeasonStats";
const PLAYER_SEASON_STATS_PLACEHOLDER_LIMIT = 10;

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
  commentaryCreated: number;
  shotsCreated: number;
  highlightsCreated: number;
  averagePositionsUpserted: number;
  momentumCreated: number;
  oddsUpserted: number;
  unmatchedPlayers: string[];
  // playerSeasonStats (season-level, tên field riêng tránh đè lên unmatchedPlayers ở trên khi cả 2
  // pipeline cùng chạy 1 run — xem apps/api/src/scraper-orchestrator.ts)
  playerSeasonStatsUpserted?: number;
  playerSeasonStatsUnmatchedPlayers?: string[];
}

interface ScraperRunRow {
  id: string;
  status: ScraperRunStatus;
  requestedLimit: number;
  dataTypes: string[];
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

// Ngưỡng ước lượng "có cần nút xem thêm không" — không đo overflow thật (cần ref+ResizeObserver,
// không cần thiết cho 1 bảng admin nội bộ), chỉ cần đủ tốt để tránh hiện nút thừa cho nội dung
// ngắn (vd chỉ chọn 1-2 loại data).
const TRUNCATE_THRESHOLD = 40;

/** Cột "Loại data"/"Kết quả" trong bảng lịch sử có thể dài (9 loại data, hoặc liệt kê nhiều loại
 * đã ghi) — cắt gọn 1 dòng theo mặc định, có nút "Xem thêm" bung ra đầy đủ theo yêu cầu. Cột dùng
 * component này PHẢI khai báo `className` width cố định (vd "w-56") + bảng cha bật `fixedLayout` —
 * xem ResourceTable.tsx. */
function TruncatedListCell({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsToggle = text.length > TRUNCATE_THRESHOLD;

  return (
    <div>
      <p className={!needsToggle || expanded ? "break-words whitespace-normal" : "truncate"}>{text}</p>
      {needsToggle ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {expanded ? "Thu gọn" : "Xem thêm"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Trang admin trigger pipeline scrape Sofascore (trước đó chỉ chạy tay 3 bước CLI, xem
 * apps/scraper-sofascore) — 2 tab tách theo loại pipeline (2026-08-20): "Scrape theo trận" (9
 * loại match-level, cần Limit) và "Player season stats" (season-level, 1 lần fetch/mùa, không
 * cần Limit — xem scraper-orchestrator.ts's runPlayerSeasonStatsPipeline()). Cả 2 tab dùng chung
 * giải đấu/mùa giải đã chọn, cùng gọi POST /admin/scraper-runs (apps/api spawn subprocess, không
 * block response), rồi poll GET /admin/scraper-runs/:id mỗi 5s trong lúc PENDING/RUNNING, đúng
 * pattern use-live-match.ts's refetchInterval.
 */
export default function AdminScraperPage() {
  const { token } = useAdminAuth();
  const queryClient = useQueryClient();
  const [competitionKey, setCompetitionKey] = useState<string>(COMPETITION_OPTIONS[0]!.key);
  const [seasonId, setSeasonId] = useState<string>("");
  const [limit, setLimit] = useState(String(DEFAULT_LIMIT));
  const [dataTypes, setDataTypes] = useState<string[]>(DEFAULT_DATA_TYPES);
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

  function toggleDataType(key: string) {
    setDataTypes((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));
  }

  // Dùng chung cho cả 2 tab (Scrape theo trận / Player season stats) — chỉ khác nhau ở dataTypes +
  // limit truyền vào, còn lại (gọi API, xử lý lỗi 409, set activeRunId) giống nhau hoàn toàn.
  async function submitRun(runDataTypes: string[], runLimit: number) {
    setSubmitError(null);
    if (!seasonId) {
      setSubmitError("Chọn mùa giải trước khi áp dụng.");
      return;
    }
    setSubmitting(true);
    try {
      const run = await apiMutateClient<ScraperRunRow>(
        "/admin/scraper-runs",
        "POST",
        { competitionKey, seasonId, limit: runLimit, dataTypes: runDataTypes },
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

  async function handleApplyMatchLevel() {
    if (dataTypes.length === 0) {
      setSubmitError("Chọn ít nhất 1 loại dữ liệu trước khi áp dụng.");
      return;
    }
    await submitRun(dataTypes, Number(limit));
  }

  async function handleApplySeasonStats() {
    await submitRun([PLAYER_SEASON_STATS_KEY], PLAYER_SEASON_STATS_PLACEHOLDER_LIMIT);
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
        </div>

        {/* 2 tab tách hẳn — "Player season stats" chạy độc lập (season-level, 1 lần fetch/mùa,
            KHÔNG theo Limit/theo trận) khỏi "Scrape theo trận" (9 loại match-level còn lại, luôn
            cần Limit). Giải đấu/mùa giải ở trên dùng CHUNG cho cả 2 tab. */}
        <Tabs defaultValue="match-level">
          <TabsList>
            <TabsTrigger value="match-level">Scrape theo trận</TabsTrigger>
            <TabsTrigger value="season-stats">Player season stats</TabsTrigger>
          </TabsList>

          <TabsContent value="match-level" className="flex flex-col gap-3 pt-3">
            <div className="flex flex-wrap items-end gap-4">
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

              <Button onClick={() => void handleApplyMatchLevel()} disabled={submitting || isBusy}>
                {submitting ? "Đang bắt đầu..." : "Apply"}
              </Button>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Loại dữ liệu</Label>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {DATA_TYPE_OPTIONS.map((opt) => (
                  <label key={opt.key} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <Checkbox checked={dataTypes.includes(opt.key)} onCheckedChange={() => toggleDataType(opt.key)} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Mùa giải &ldquo;hiện tại&rdquo; thường CHƯA có trận đấu xong — mùa đã kết thúc (không
              đánh dấu hiện tại) mới thường có trận cần scrape.
            </p>
          </TabsContent>

          <TabsContent value="season-stats" className="flex flex-col gap-3 pt-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Lấy chỉ số nâng cao (rating/xG/xA/thẻ vàng-đỏ/tackles/...) cho MỌI cầu thủ lọt top-50
              ít nhất 1 trong 34 chỉ số của mùa giải đã chọn — 1 lần fetch cho cả giải, không theo
              từng trận nên không cần chọn Limit.
            </p>
            <div>
              <Button onClick={() => void handleApplySeasonStats()} disabled={submitting || isBusy}>
                {submitting ? "Đang bắt đầu..." : "Apply"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>

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
                {/* Chỉ hiện loại > 0 — run chỉ chọn 1-2 loại data thì các loại còn lại luôn = 0,
                    không cần liệt kê hết 10 loại mỗi lần. `unmatchedPlayers` có thể undefined nếu
                    run CHỈ chọn playerSeasonStats (pipeline match-level không chạy) — optional
                    chaining, không giả định luôn có mặt. */}
                Đã ghi:{" "}
                {[
                  [run.ingestSummary.eventsCreated, "event"],
                  [run.ingestSummary.lineupsUpserted, "lineup"],
                  [run.ingestSummary.ratingsUpserted, "rating"],
                  [run.ingestSummary.statisticsUpserted, "statistic"],
                  [run.ingestSummary.commentaryCreated, "commentary"],
                  [run.ingestSummary.shotsCreated, "shot"],
                  [run.ingestSummary.highlightsCreated, "highlight"],
                  [run.ingestSummary.averagePositionsUpserted, "average position"],
                  [run.ingestSummary.momentumCreated, "momentum point"],
                  [run.ingestSummary.oddsUpserted, "odds market"],
                  [run.ingestSummary.playerSeasonStatsUpserted, "player season stats"],
                ]
                  .filter(([count]) => (count as number) > 0)
                  .map(([count, label]) => `${count} ${label}`)
                  .join(", ") || "không có gì mới"}
                {(run.ingestSummary.unmatchedPlayers?.length ?? 0) > 0
                  ? ` (${run.ingestSummary.unmatchedPlayers.length} cầu thủ không khớp được)`
                  : ""}
                {(run.ingestSummary.playerSeasonStatsUnmatchedPlayers?.length ?? 0) > 0
                  ? ` (${run.ingestSummary.playerSeasonStatsUnmatchedPlayers!.length} player season stats không khớp được)`
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
              fixedLayout
              columns={[
                {
                  key: "createdAt",
                  label: "Thời gian",
                  className: "w-40",
                  render: (row) => new Date(row.createdAt).toLocaleString("vi-VN"),
                },
                { key: "competition", label: "Giải đấu", className: "w-36", render: (row) => row.competition.name },
                { key: "season", label: "Mùa", className: "w-16", render: (row) => row.season.name },
                {
                  key: "requestedLimit",
                  label: "Limit",
                  className: "w-14",
                  // playerSeasonStats không dùng Limit — hiện "—" thay vì số giả (xem
                  // PLAYER_SEASON_STATS_PLACEHOLDER_LIMIT) để không gây hiểu nhầm.
                  render: (row) =>
                    row.dataTypes.length === 1 && row.dataTypes[0] === PLAYER_SEASON_STATS_KEY
                      ? "—"
                      : row.requestedLimit,
                },
                {
                  key: "dataTypes",
                  label: "Loại data",
                  className: "w-56",
                  render: (row) => <TruncatedListCell text={row.dataTypes.join(", ")} />,
                },
                {
                  key: "status",
                  label: "Trạng thái",
                  className: "w-28",
                  render: (row) => <Badge variant={STATUS_BADGE_VARIANT[row.status]}>{row.status}</Badge>,
                },
                {
                  key: "result",
                  label: "Kết quả",
                  className: "w-56",
                  render: (row) => {
                    if (!row.ingestSummary) return <TruncatedListCell text={row.errorMessage ?? "—"} />;
                    const parts = [
                      [row.ingestSummary.eventsCreated, "event"],
                      [row.ingestSummary.lineupsUpserted, "lineup"],
                      [row.ingestSummary.commentaryCreated, "commentary"],
                      [row.ingestSummary.shotsCreated, "shot"],
                      [row.ingestSummary.highlightsCreated, "highlight"],
                      [row.ingestSummary.averagePositionsUpserted, "avg. position"],
                      [row.ingestSummary.momentumCreated, "momentum"],
                      [row.ingestSummary.oddsUpserted, "odds"],
                      [row.ingestSummary.playerSeasonStatsUpserted, "season stats"],
                    ]
                      .filter(([count]) => (count as number) > 0)
                      .map(([count, label]) => `${count} ${label}`)
                      .join(", ");
                    return <TruncatedListCell text={parts || "không có gì mới"} />;
                  },
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
