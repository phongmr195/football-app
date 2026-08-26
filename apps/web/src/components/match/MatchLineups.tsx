import { Badge, type BadgeVariant } from "@football-app/ui";
import { playerPositionMeta } from "@/lib/format";
import type { MatchLineupPlayer, MatchLineupsResponse, MatchTeam } from "@/lib/types";

export interface MatchLineupsProps {
  lineups: MatchLineupsResponse;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
}

function ratingVariant(rating: number): BadgeVariant {
  if (rating >= 7.5) return "success";
  if (rating >= 6.5) return "info";
  if (rating >= 6) return "warning";
  return "danger";
}

function PlayerRow({ player }: { player: MatchLineupPlayer }) {
  const { label, variant } = playerPositionMeta(player.position);
  return (
    <li className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
      <span className="w-6 shrink-0 text-center text-zinc-400 dark:text-zinc-500">
        {player.shirtNumber ?? "-"}
      </span>
      <span className="flex-1 truncate">{player.name}</span>
      <Badge variant={variant}>{label}</Badge>
      {player.rating !== null ? (
        <Badge variant={ratingVariant(player.rating)}>{player.rating.toFixed(1)}</Badge>
      ) : null}
    </li>
  );
}

function TeamLineup({ teamName, lineup }: { teamName: string; lineup: MatchLineupsResponse["home"] }) {
  const starters = lineup.players.filter((p) => p.isStarting);
  const subs = lineup.players.filter((p) => !p.isStarting);

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{teamName}</h3>
        {lineup.formation ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{lineup.formation}</span>
        ) : null}
      </div>
      {starters.length === 0 && subs.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Chưa có dữ liệu đội hình.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {starters.map((p) => (
              <PlayerRow key={p.playerId} player={p} />
            ))}
          </ul>
          {subs.length > 0 ? (
            <>
              <p className="mt-1 text-xs font-medium text-zinc-400 dark:text-zinc-500">Dự bị</p>
              <ul className="flex flex-col gap-1.5">
                {subs.map((p) => (
                  <PlayerRow key={p.playerId} player={p} />
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

// Server Component thuần — nhận data đã fetch (GET /matches/:id/lineups) qua props, dùng cho tab
// "Đội hình" (thứ tự theo đội hình thật, starter/sub). Rating vẫn hiện inline ở đây (không chỉ ở
// tab "Rating" riêng, xem MatchPlayerRatings.tsx) — 2 tab phục vụ mục đích khác nhau: tab này trả
// lời "ai đá vị trí nào", tab Rating trả lời "ai chơi tốt nhất" (sort theo điểm).
export function MatchLineups({ lineups, homeTeam, awayTeam }: MatchLineupsProps) {
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
      <TeamLineup teamName={homeTeam.name} lineup={lineups.home} />
      <TeamLineup teamName={awayTeam.name} lineup={lineups.away} />
    </div>
  );
}
