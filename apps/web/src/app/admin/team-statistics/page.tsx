"use client";

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/admin/Combobox";
import { MultiCombobox } from "@/components/admin/MultiCombobox";
import { ApiError, apiGetClient, apiMutateClient, type ApiListResponse } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";
import type { TeamStatistics } from "@/lib/types";

interface TeamOption {
  id: string;
  name: string;
}

interface SeasonOption {
  id: string;
  name: string;
  competition: { id: string; name: string };
}

interface RecomputeResult {
  team: { id: string; name: string };
  hasMatches: boolean;
  statistics: TeamStatistics | null;
  cleanSheetRank: number | null;
  cleanSheetCount: number;
}

interface RecomputeResponse {
  season: { id: string; name: string; competition: { id: string; name: string } };
  results: RecomputeResult[];
  summary: {
    processedMatches: number;
    skippedMatches: number;
    seasonTeamsUpdated: number;
  };
}

function StatsGrid({
  stats,
  cleanSheetRank,
}: {
  stats: TeamStatistics;
  cleanSheetRank?: number | null;
}) {
  const items = [
    { label: "Thắng", value: stats.wins },
    { label: "Hòa", value: stats.draws },
    { label: "Thua", value: stats.losses },
    { label: "Bàn thắng", value: stats.goalsFor },
    { label: "Bàn thua", value: stats.goalsAgainst },
    { label: "Giữ sạch lưới", value: stats.cleanSheets },
    { label: "Hiệu số", value: stats.goalsFor - stats.goalsAgainst },
    { label: "Hạng clean sheet", value: cleanSheetRank ?? "—" },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{item.label}</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export default function AdminTeamStatisticsPage() {
  const { token } = useAdminAuth();
  const queryClient = useQueryClient();
  const [teamSearch, setTeamSearch] = useState("");
  const [seasonSearch, setSeasonSearch] = useState("");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<RecomputeResponse | null>(null);

  const seasonsQuery = useQuery({
    queryKey: ["admin-team-statistics-seasons", seasonSearch],
    queryFn: () =>
      apiGetClient<ApiListResponse<SeasonOption>>(
        "/seasons",
        { pageSize: 50, search: seasonSearch || undefined },
        { idToken: token },
      ),
    enabled: !!token,
  });

  // Lọc theo seasonId đã chọn — KHÔNG liệt kê toàn bộ team trong DB (hàng nghìn, không lọc gì cả
  // là bug thật đã gặp: admin dễ chọn nhầm đội chưa từng đá season này, dropdown lại chỉ hiện 20
  // đội đầu nên đội đã chọn trước đó có thể rơi khỏi list hiện tại). `enabled` chỉ bật sau khi có
  // season — bắt buộc chọn mùa giải TRƯỚC khi chọn đội.
  const teamsQuery = useQuery({
    queryKey: ["admin-team-statistics-teams", selectedSeasonId, teamSearch],
    queryFn: () =>
      apiGetClient<ApiListResponse<TeamOption>>(
        "/teams",
        { pageSize: 50, search: teamSearch || undefined, seasonId: selectedSeasonId },
        { idToken: token },
      ),
    enabled: !!token && !!selectedSeasonId,
  });

  // 1 query/đội đã chọn (song song qua useQueries, KHÔNG phải N lần re-render tuần tự) — multi-
  // select nên "thống kê hiện tại" giờ là danh sách nhiều đội, không còn 1 đội duy nhất.
  const currentStatsQueries = useQueries({
    queries: selectedTeamIds.map((teamId) => ({
      queryKey: ["admin-team-statistics-current", teamId, selectedSeasonId],
      queryFn: () =>
        apiGetClient<TeamStatistics>(`/statistics/teams/${teamId}`, { seasonId: selectedSeasonId }, { idToken: token }),
      enabled: !!token && !!teamId && !!selectedSeasonId,
      retry: false,
    })),
  });

  const teamOptions = teamsQuery.data?.items ?? [];
  const seasonOptions = seasonsQuery.data?.items ?? [];
  const teamNameById = new Map(teamOptions.map((team) => [team.id, team.name]));

  const comboboxOptions = teamOptions.map((team) => ({ id: team.id, label: team.name }));
  const seasonComboboxOptions = seasonOptions.map((season) => ({
    id: season.id,
    label: season.name,
    description: season.competition.name,
  }));

  async function handleRecompute() {
    if (selectedTeamIds.length === 0 || !selectedSeasonId) {
      setSubmitError("Chọn ít nhất 1 đội bóng và mùa giải trước khi áp dụng.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await apiMutateClient<RecomputeResponse>(
        "/admin/team-statistics/recompute",
        "POST",
        { teamIds: selectedTeamIds, seasonId: selectedSeasonId },
        { idToken: token },
      );
      setLastResult(result);
      await Promise.all(
        selectedTeamIds.map((teamId) =>
          queryClient.invalidateQueries({
            queryKey: ["admin-team-statistics-current", teamId, selectedSeasonId],
          }),
        ),
      );
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : "Có lỗi xảy ra, thử lại sau.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          <BarChart3 className="h-6 w-6" aria-hidden="true" />
          Thống kê đội bóng theo mùa
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Tính lại `TeamStatistics` từ các trận `FINISHED` đã có trong DB của mùa giải đã chọn.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Chọn dữ liệu cần thống kê</CardTitle>
          <CardDescription>
            API sẽ tính lại toàn mùa để giữ bảng thống kê và clean sheet đồng bộ — có thể chọn nhiều đội cùng lúc.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Mùa giải</Label>
              <Combobox
                value={selectedSeasonId}
                onChange={(value) => {
                  // Đổi season -> reset đội đã chọn: đội hợp lệ cho season cũ có thể không đá
                  // season mới.
                  setSelectedSeasonId(value);
                  setSelectedTeamIds([]);
                }}
                options={seasonComboboxOptions}
                search={seasonSearch}
                onSearchChange={setSeasonSearch}
                loading={seasonsQuery.isLoading}
                placeholder="Chọn mùa giải"
                searchPlaceholder="Tìm theo tên mùa giải..."
                emptyText="Không tìm thấy mùa giải nào."
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Đội bóng</Label>
              <MultiCombobox
                value={selectedTeamIds}
                onChange={setSelectedTeamIds}
                options={comboboxOptions}
                search={teamSearch}
                onSearchChange={setTeamSearch}
                loading={teamsQuery.isLoading}
                disabled={!selectedSeasonId}
                placeholder={selectedSeasonId ? "Chọn đội bóng" : "Chọn mùa giải trước"}
                searchPlaceholder="Tìm theo tên đội..."
                emptyText="Không tìm thấy đội bóng nào."
              />
              {selectedSeasonId && teamOptions.length === 0 && !teamsQuery.isLoading ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Mùa giải này chưa có đội bóng nào có trận đấu trong DB.
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => void handleRecompute()}
              disabled={submitting || selectedTeamIds.length === 0 || !selectedSeasonId}
            >
              {submitting ? "Đang thống kê..." : "Thống kê lại"}
            </Button>
            {submitError ? <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Thống kê hiện tại</CardTitle>
          <CardDescription>Giá trị đang lưu trong `team_statistics` cho (các) đội và mùa giải đã chọn.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {selectedTeamIds.length === 0 || !selectedSeasonId ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Chọn đội bóng và mùa giải để xem dữ liệu hiện tại.</p>
          ) : (
            selectedTeamIds.map((teamId, index) => {
              const query = currentStatsQueries[index];
              const missing = query?.error instanceof ApiError && query.error.status === 404;
              return (
                <div key={teamId} className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {teamNameById.get(teamId) ?? teamId}
                  </p>
                  {query?.isLoading ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Đang tải...</p>
                  ) : missing ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Hiện chưa có thống kê lưu sẵn cho lựa chọn này.</p>
                  ) : query?.error ? (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {query.error instanceof ApiError ? query.error.message : "Không tải được thống kê hiện tại."}
                    </p>
                  ) : query?.data ? (
                    <StatsGrid stats={query.data} />
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {lastResult ? (
        <Card>
          <CardHeader>
            <CardTitle>Kết quả lần thống kê gần nhất</CardTitle>
            <CardDescription>
              {lastResult.season.name} ({lastResult.season.competition.name}) — {lastResult.results.length} đội
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Số trận xử lý</p>
                <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {lastResult.summary.processedMatches}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Trận bị bỏ qua</p>
                <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {lastResult.summary.skippedMatches}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Đội trong cả mùa được cập nhật</p>
                <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {lastResult.summary.seasonTeamsUpdated}
                </p>
              </div>
            </div>

            {lastResult.results.map((result) => (
              <div key={result.team.id} className="flex flex-col gap-2 border-t border-zinc-200 pt-4 first:border-t-0 first:pt-0 dark:border-zinc-800">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{result.team.name}</p>
                {result.hasMatches && result.statistics ? (
                  <StatsGrid stats={result.statistics} cleanSheetRank={result.cleanSheetRank} />
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Đội này chưa có trận FINISHED-có-tỉ-số nào trong mùa giải đã chọn.
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
