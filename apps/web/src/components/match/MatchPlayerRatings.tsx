import { Badge, type BadgeVariant } from "@football-app/ui";
import { playerPositionMeta } from "@/lib/format";
import type { MatchLineupPlayer, MatchLineupsResponse, MatchTeam } from "@/lib/types";

export interface MatchPlayerRatingsProps {
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

function RatingRow({ player }: { player: MatchLineupPlayer & { rating: number } }) {
  const { label, variant } = playerPositionMeta(player.position);
  return (
    <li className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
      <span className="w-6 shrink-0 text-center text-zinc-400 dark:text-zinc-500">
        {player.shirtNumber ?? "-"}
      </span>
      <span className="flex-1 truncate">{player.name}</span>
      <Badge variant={variant}>{label}</Badge>
      <Badge variant={ratingVariant(player.rating)}>{player.rating.toFixed(1)}</Badge>
    </li>
  );
}

function TeamRatings({ teamName, lineup }: { teamName: string; lineup: MatchLineupsResponse["home"] }) {
  // Chỉ liệt kê cầu thủ có rating (đã ra sân) — mục đích tab này là xếp hạng phong độ, không phải
  // liệt kê toàn đội hình như tab "Đội hình" (khác MatchLineups.tsx: không tách starter/sub, sort
  // theo rating giảm dần thay vì theo thứ tự đội hình).
  const rated = lineup.players
    .filter((player): player is MatchLineupPlayer & { rating: number } => player.rating !== null)
    .sort((a, b) => b.rating - a.rating);

  return (
    <div className="flex flex-1 flex-col gap-3">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{teamName}</h3>
      {rated.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Chưa có dữ liệu rating.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rated.map((player) => (
            <RatingRow key={player.playerId} player={player} />
          ))}
        </ul>
      )}
    </div>
  );
}

// Server Component thuần — nhận data đã fetch (GET /matches/:id/lineups), dùng cho tab "Rating"
// riêng trong MatchDetailTabs (khác MatchLineups.tsx dùng cho tab "Đội hình").
export function MatchPlayerRatings({ lineups, homeTeam, awayTeam }: MatchPlayerRatingsProps) {
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
      <TeamRatings teamName={homeTeam.name} lineup={lineups.home} />
      <TeamRatings teamName={awayTeam.name} lineup={lineups.away} />
    </div>
  );
}
