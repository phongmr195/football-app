export interface TeamAggregateMatchInput {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface TeamAggregateStats {
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
}

export interface CalculatedTeamSeasonStatistics {
  statsByTeamId: Map<string, TeamAggregateStats>;
  skippedMatches: number;
}

const EMPTY_STATS: TeamAggregateStats = {
  wins: 0,
  draws: 0,
  losses: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  cleanSheets: 0,
};

export function calculateTeamSeasonStatistics(
  matches: TeamAggregateMatchInput[],
): CalculatedTeamSeasonStatistics {
  const statsByTeamId = new Map<string, TeamAggregateStats>();
  let skippedMatches = 0;

  function ensure(teamId: string): TeamAggregateStats {
    const existing = statsByTeamId.get(teamId);
    if (existing) return existing;

    const created = { ...EMPTY_STATS };
    statsByTeamId.set(teamId, created);
    return created;
  }

  for (const match of matches) {
    if (match.homeScore === null || match.awayScore === null) {
      skippedMatches++;
      continue;
    }

    const home = ensure(match.homeTeamId);
    const away = ensure(match.awayTeamId);

    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;

    if (match.homeScore > match.awayScore) {
      home.wins++;
      away.losses++;
    } else if (match.homeScore < match.awayScore) {
      away.wins++;
      home.losses++;
    } else {
      home.draws++;
      away.draws++;
    }

    if (match.awayScore === 0) home.cleanSheets++;
    if (match.homeScore === 0) away.cleanSheets++;
  }

  return { statsByTeamId, skippedMatches };
}

export interface RankedCleanSheetEntry {
  teamId: string;
  count: number;
  rank: number;
}

export function rankCleanSheetTeams(statsByTeamId: Map<string, TeamAggregateStats>): RankedCleanSheetEntry[] {
  return [...statsByTeamId.entries()]
    .filter(([, stats]) => stats.cleanSheets > 0)
    .sort((a, b) => b[1].cleanSheets - a[1].cleanSheets)
    .map(([teamId, stats], index) => ({
      teamId,
      count: stats.cleanSheets,
      rank: index + 1,
    }));
}

export interface CalculatedStandingRow {
  teamId: string;
  position: number;
  played: number;
  win: number;
  draw: number;
  loss: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
}

/**
 * Xếp hạng standings từ `statsByTeamId` (output của `calculateTeamSeasonStatistics()`) — tie-break
 * theo điểm số -> hiệu số -> số bàn thắng (thứ tự phổ biến nhất của các giải), KHÔNG có head-to-
 * head (cần lịch sử đối đầu trực tiếp, không có input đủ ở tầng này) — chấp nhận được vì trường
 * hợp cần tie-break xa hơn hiệu số/bàn thắng rất hiếm khi xảy ra ở 1 mùa giải đầy đủ.
 */
export function rankStandings(statsByTeamId: Map<string, TeamAggregateStats>): CalculatedStandingRow[] {
  return [...statsByTeamId.entries()]
    .map(([teamId, stats]) => {
      const played = stats.wins + stats.draws + stats.losses;
      const gd = stats.goalsFor - stats.goalsAgainst;
      const points = stats.wins * 3 + stats.draws;
      return { teamId, played, win: stats.wins, draw: stats.draws, loss: stats.losses, gf: stats.goalsFor, ga: stats.goalsAgainst, gd, points };
    })
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf)
    .map((row, index) => ({ ...row, position: index + 1 }));
}
