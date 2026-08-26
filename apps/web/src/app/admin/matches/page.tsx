"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResourceTable } from "@/components/admin/ResourceTable";
import { ApiError, apiGetClient, apiMutateClient, type ApiListResponse } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { matchStatusMeta } from "@/lib/format";
import type { Match, MatchDetail, MatchStatus } from "@/lib/types";

const MATCH_STATUSES: MatchStatus[] = ["SCHEDULED", "LIVE", "HALFTIME", "FINISHED", "POSTPONED", "CANCELLED"];
const ALL_STATUS = "__all__";
const PAGE_SIZE = 20;

// Note: kickoffAt hiển thị/sửa qua <input type="datetime-local"> theo giờ UTC thô (không convert
// timezone) — đủ cho nhu cầu sửa tay của admin, không phải trang public-facing.
function toDatetimeLocalValue(iso: string): string {
  return iso.slice(0, 16);
}

export default function AdminMatchesPage() {
  const { token } = useAdminAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL_STATUS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["admin-matches", page, search, status],
    queryFn: () =>
      apiGetClient<ApiListResponse<Match>>(
        "/matches",
        { page, pageSize: PAGE_SIZE, search: search || undefined, status: status === ALL_STATUS ? undefined : status },
        { idToken: token },
      ),
    enabled: !!token,
  });

  const rows = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        <CalendarClock className="h-6 w-6" aria-hidden="true" />
        Trận đấu
      </h1>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Tìm theo tên đội..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
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
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUS}>Mọi trạng thái</SelectItem>
            {MATCH_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {matchStatusMeta(s).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {listQuery.isLoading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Đang tải...</p>
      ) : (
        <>
          <ResourceTable
            columns={[
              { key: "kickoffAt", label: "Kick-off", render: (row) => new Date(row.kickoffAt).toLocaleString("vi-VN") },
              { key: "competition", label: "Giải đấu", render: (row) => row.competition.name },
              {
                key: "match",
                label: "Trận",
                render: (row) => `${row.homeTeam.name} ${row.homeScore ?? "-"} : ${row.awayScore ?? "-"} ${row.awayTeam.name}`,
              },
              { key: "status", label: "Trạng thái", render: (row) => matchStatusMeta(row.status).label },
            ]}
            rows={rows}
            onRowClick={(row) => setSelectedId(row.id)}
            emptyMessage="Không có trận đấu nào."
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

      {selectedId ? (
        <MatchEditDialog
          matchId={selectedId}
          token={token}
          onClose={() => setSelectedId(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin-matches"] })}
        />
      ) : null}
    </div>
  );
}

function MatchEditDialog({
  matchId,
  token,
  onClose,
  onSaved,
}: {
  matchId: string;
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const detailQuery = useQuery({
    queryKey: ["admin-match-detail", matchId],
    queryFn: () => apiGetClient<MatchDetail>(`/matches/${matchId}`, undefined, { idToken: token }),
    enabled: !!token,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sửa trận đấu</DialogTitle>
        </DialogHeader>
        {detailQuery.isLoading || !detailQuery.data ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Đang tải...</p>
        ) : (
          <MatchEditForms match={detailQuery.data} token={token} onSaved={onSaved} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MatchEditForms({
  match,
  token,
  onSaved,
}: {
  match: MatchDetail;
  token: string | null;
  onSaved: () => void;
}) {
  const [kickoffAt, setKickoffAt] = useState(toDatetimeLocalValue(match.kickoffAt));
  const [matchStatus, setMatchStatus] = useState<MatchStatus>(match.status);
  const [homeScore, setHomeScore] = useState(match.homeScore == null ? "" : String(match.homeScore));
  const [awayScore, setAwayScore] = useState(match.awayScore == null ? "" : String(match.awayScore));
  const [liveStreamUrl, setLiveStreamUrl] = useState(match.liveStreamUrl ?? "");
  const [matchSubmitting, setMatchSubmitting] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  const live = match.liveState;
  const [liveStatus, setLiveStatus] = useState<MatchStatus>(live?.status ?? match.status);
  const [minute, setMinute] = useState(live?.minute == null ? "" : String(live.minute));
  const [liveHomeScore, setLiveHomeScore] = useState(String(live?.homeScore ?? match.homeScore ?? 0));
  const [liveAwayScore, setLiveAwayScore] = useState(String(live?.awayScore ?? match.awayScore ?? 0));
  const [lastEventSeq, setLastEventSeq] = useState(String(live?.lastEventSeq ?? 0));
  const [liveSubmitting, setLiveSubmitting] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  async function submitMatch() {
    setMatchSubmitting(true);
    setMatchError(null);
    try {
      await apiMutateClient(
        `/matches/${match.id}`,
        "PATCH",
        {
          kickoffAt: new Date(kickoffAt).toISOString(),
          status: matchStatus,
          homeScore: homeScore === "" ? null : Number(homeScore),
          awayScore: awayScore === "" ? null : Number(awayScore),
          liveStreamUrl: liveStreamUrl.trim() === "" ? null : liveStreamUrl.trim(),
        },
        { idToken: token },
      );
      onSaved();
    } catch (err) {
      setMatchError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau.");
    } finally {
      setMatchSubmitting(false);
    }
  }

  async function submitLiveState() {
    setLiveSubmitting(true);
    setLiveError(null);
    try {
      await apiMutateClient(
        `/matches/${match.id}/live`,
        "PUT",
        {
          status: liveStatus,
          minute: minute === "" ? null : Number(minute),
          homeScore: Number(liveHomeScore) || 0,
          awayScore: Number(liveAwayScore) || 0,
          lastEventSeq: Number(lastEventSeq) || 0,
        },
        { idToken: token },
      );
      onSaved();
    } catch (err) {
      setLiveError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau.");
    } finally {
      setLiveSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {match.homeTeam.name} vs {match.awayTeam.name}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitMatch();
        }}
        className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Thông tin trận đấu</h3>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kickoffAt">Kick-off</Label>
          <Input id="kickoffAt" type="datetime-local" value={kickoffAt} onChange={(e) => setKickoffAt(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="match-status">Trạng thái</Label>
          <Select value={matchStatus} onValueChange={(v) => v && setMatchStatus(v as MatchStatus)}>
            <SelectTrigger id="match-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MATCH_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {matchStatusMeta(s).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="home-score">Tỉ số nhà</Label>
            <Input id="home-score" type="number" value={homeScore} onChange={(e) => setHomeScore(e.target.value)} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="away-score">Tỉ số khách</Label>
            <Input id="away-score" type="number" value={awayScore} onChange={(e) => setAwayScore(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="live-stream-url">Link live stream (YouTube hoặc HLS .m3u8)</Label>
          <Input
            id="live-stream-url"
            type="text"
            placeholder="https://youtube.com/watch?v=... hoặc https://.../stream.m3u8"
            value={liveStreamUrl}
            onChange={(e) => setLiveStreamUrl(e.target.value)}
          />
        </div>
        {matchError ? <p className="text-sm text-red-600 dark:text-red-400">{matchError}</p> : null}
        <DialogFooter>
          <Button type="submit" disabled={matchSubmitting}>
            {matchSubmitting ? "Đang lưu..." : "Lưu trận đấu"}
          </Button>
        </DialogFooter>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitLiveState();
        }}
        className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          LiveMatchState {live ? "" : "(chưa có — lưu để tạo mới)"}
        </h3>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="live-status">Trạng thái live</Label>
          <Select value={liveStatus} onValueChange={(v) => v && setLiveStatus(v as MatchStatus)}>
            <SelectTrigger id="live-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MATCH_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {matchStatusMeta(s).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="minute">Phút</Label>
            <Input id="minute" type="number" value={minute} onChange={(e) => setMinute(e.target.value)} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="live-home-score">Tỉ số nhà</Label>
            <Input id="live-home-score" type="number" value={liveHomeScore} onChange={(e) => setLiveHomeScore(e.target.value)} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="live-away-score">Tỉ số khách</Label>
            <Input id="live-away-score" type="number" value={liveAwayScore} onChange={(e) => setLiveAwayScore(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="last-event-seq">lastEventSeq</Label>
          <Input id="last-event-seq" type="number" value={lastEventSeq} onChange={(e) => setLastEventSeq(e.target.value)} />
        </div>
        {liveError ? <p className="text-sm text-red-600 dark:text-red-400">{liveError}</p> : null}
        <DialogFooter>
          <Button type="submit" disabled={liveSubmitting}>
            {liveSubmitting ? "Đang lưu..." : "Lưu live state"}
          </Button>
        </DialogFooter>
      </form>
    </div>
  );
}
