/**
 * Local response types for apps/api's read-only browse endpoints (competitions/standings).
 *
 * These mirror the JSON shape apps/api actually returns (Prisma model fields, camelCase),
 * not packages/data-provider's canonical provider model (that's the sync-worker's internal
 * shape, pre-mapping). Kept local to apps/web for now — move to packages/shared if/when
 * apps/mobile resumes and needs the same shapes.
 */

export type CompetitionType = "LEAGUE" | "CUP" | "INTERNATIONAL";

/** Matches packages/data-provider's ExternalRef shape — {provider, id} identifies the row
 * within whichever data provider synced it (see CLAUDE.md § Data provider). */
export interface ExternalRef {
  provider: string;
  id: string;
}

export interface Competition {
  id: string;
  name: string;
  type: CompetitionType;
  countryCode: string | null;
  logoUrl: string | null;
  externalRef: ExternalRef;
}

export interface Season {
  id: string;
  competitionId: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

export interface CompetitionDetail extends Competition {
  seasons: Season[];
}

export interface StandingTeam {
  id: string;
  name: string;
  logoUrl: string | null;
}

export type MatchStatus =
  | "SCHEDULED"
  | "LIVE"
  | "HALFTIME"
  | "FINISHED"
  | "POSTPONED"
  | "CANCELLED";

export interface MatchTeam {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface MatchCompetition {
  id: string;
  name: string;
  logoUrl: string | null;
  externalRef: ExternalRef;
}

export interface Match {
  id: string;
  competitionId: string;
  competition: MatchCompetition;
  seasonId: string;
  homeTeamId: string;
  homeTeam: MatchTeam;
  awayTeamId: string;
  awayTeam: MatchTeam;
  kickoffAt: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
}

export interface LiveMatchState {
  matchId: string;
  status: MatchStatus;
  minute: number | null;
  homeScore: number;
  awayScore: number;
  lastEventSeq: number;
  updatedAt: string;
}

export interface MatchDetail extends Match {
  liveState: LiveMatchState | null;
}

export interface Stadium {
  id: string;
  name: string;
  city: string | null;
  countryCode: string | null;
  capacity: number | null;
}

export interface Team {
  id: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  countryCode: string | null;
  founded: number | null;
  stadiumId: string | null;
  externalRef: ExternalRef;
}

export interface TeamDetail extends Team {
  stadium: Stadium | null;
}

export interface Player {
  id: string;
  name: string;
  dateOfBirth: string | null;
  nationality: string | null;
  position: string | null;
  heightCm: number | null;
  teamId: string | null;
  externalRef: ExternalRef;
}

export interface PlayerDetail extends Player {
  team: Team | null;
}

/**
 * Shapes returned by apps/api's GET /favorites/teams and /favorites/players (piece 6a) — these
 * are deliberately narrower than Team/Player above (just what favorites.ts's `teamSelect`/
 * `playerSelect` project), not full Team/Player objects. See apps/api/src/routes/favorites.ts.
 */
export interface FavoriteTeamItem {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface FavoritePlayerItem {
  id: string;
  name: string;
  position: string | null;
  teamId: string | null;
}

export type MatchResult = "WIN" | "DRAW" | "LOSS";

export interface RecentFormEntry {
  matchId: string;
  result: MatchResult;
  homeScore: number;
  awayScore: number;
  isHome: boolean;
  opponent: StandingTeam;
  kickoffAt: string;
}

export interface Standing {
  id: string;
  seasonId: string;
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
  team: StandingTeam;
  /** Last 5 FINISHED matches in this season, oldest -> newest (see apps/api/src/routes/standings.ts). */
  recentForm: RecentFormEntry[];
}
