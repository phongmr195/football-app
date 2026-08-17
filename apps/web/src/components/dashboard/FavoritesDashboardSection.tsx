"use client";

import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGetClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatKickoffAt } from "@/lib/format";
import { useFavoriteTeams } from "@/lib/use-favorites";
import type { ApiListResponse } from "@/lib/api-client";
import type { Match } from "@/lib/types";

const PREVIEW_COUNT = 3;

/**
 * Personalized dashboard block — the whole reason favorites + push notifications exist is to
 * surface exactly this on the pages a user actually opens, not just inside `/favorites`. Firebase
 * auth is client-only in this app (see lib/auth-context.tsx), so this entire block — including
 * its logged-out state — has to be a client island; the Server Component shell (app/page.tsx)
 * can never know at request time whether a visitor is signed in.
 */
export function FavoritesDashboardSection() {
  const { user, loading: authLoading } = useAuth();
  const teamsQuery = useFavoriteTeams();
  const teams = teamsQuery.data ?? [];
  const teamIds = teams.map((t) => t.id).join(",");

  const upcomingQuery = useQuery({
    queryKey: ["dashboard", "favorites", "upcoming", teamIds],
    queryFn: async () => {
      const { items } = await apiGetClient<ApiListResponse<Match>>("/matches", {
        teamIds,
        status: "SCHEDULED",
        order: "asc",
        pageSize: PREVIEW_COUNT,
      });
      return items;
    },
    enabled: teamIds.length > 0,
  });

  const recentQuery = useQuery({
    queryKey: ["dashboard", "favorites", "recent", teamIds],
    queryFn: async () => {
      const { items } = await apiGetClient<ApiListResponse<Match>>("/matches", {
        teamIds,
        status: "FINISHED",
        order: "desc",
        pageSize: PREVIEW_COUNT,
      });
      return items;
    },
    enabled: teamIds.length > 0,
  });

  if (authLoading) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  if (!user) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Đăng nhập để theo dõi đội bóng yêu thích và nhận thông báo khi họ ghi bàn.
          </p>
          <Link href="/auth">
            <Button>Đăng nhập</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (teamsQuery.isLoading) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  if (teams.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Chưa có đội bóng yêu thích nào — theo dõi 1 đội để xem lịch thi đấu và kết quả ngay tại đây.
          </p>
          <Link href="/competitions">
            <Button variant="outline">Khám phá giải đấu</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Sắp diễn ra</h3>
        {!upcomingQuery.data || upcomingQuery.data.length === 0 ? (
          <Card>
            <CardContent className="py-4 text-sm text-zinc-500 dark:text-zinc-400">
              Chưa có lịch thi đấu sắp tới cho các đội bạn theo dõi.
            </CardContent>
          </Card>
        ) : (
          upcomingQuery.data.map((match) => (
            <FavoriteMatchRow key={match.id} match={match} showScore={false} />
          ))
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Kết quả gần đây</h3>
        {!recentQuery.data || recentQuery.data.length === 0 ? (
          <Card>
            <CardContent className="py-4 text-sm text-zinc-500 dark:text-zinc-400">
              Chưa có kết quả nào cho các đội bạn theo dõi.
            </CardContent>
          </Card>
        ) : (
          recentQuery.data.map((match) => (
            <FavoriteMatchRow key={match.id} match={match} showScore />
          ))
        )}
      </div>
    </div>
  );
}

function FavoriteMatchRow({ match, showScore }: { match: Match; showScore: boolean }) {
  return (
    <Link href={`/matches/${match.id}`}>
      <Card className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
        <CardContent className="flex flex-col gap-1 px-4 py-3">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {formatKickoffAt(match.kickoffAt)}
          </span>
          <div className="flex items-center justify-between gap-2 text-sm">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {match.homeTeam.logoUrl ? (
                <Image src={match.homeTeam.logoUrl} alt={match.homeTeam.name} width={16} height={16} className="h-4 w-4 object-contain" />
              ) : null}
              <span className="truncate text-zinc-900 dark:text-zinc-50">{match.homeTeam.name}</span>
            </div>
            {showScore ? (
              <span className="shrink-0 font-medium text-zinc-900 dark:text-zinc-50">
                {match.homeScore} - {match.awayScore}
              </span>
            ) : (
              <span className="shrink-0 text-zinc-400 dark:text-zinc-600">vs</span>
            )}
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
              <span className="truncate text-zinc-900 dark:text-zinc-50">{match.awayTeam.name}</span>
              {match.awayTeam.logoUrl ? (
                <Image src={match.awayTeam.logoUrl} alt={match.awayTeam.name} width={16} height={16} className="h-4 w-4 object-contain" />
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
