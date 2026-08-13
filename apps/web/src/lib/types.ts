/**
 * Local response types for apps/api's read-only browse endpoints (competitions/standings).
 *
 * These mirror the JSON shape apps/api actually returns (Prisma model fields, camelCase),
 * not packages/data-provider's canonical provider model (that's the sync-worker's internal
 * shape, pre-mapping). Kept local to apps/web for now — move to packages/shared if/when
 * apps/mobile resumes and needs the same shapes.
 */

export type CompetitionType = "LEAGUE" | "CUP" | "INTERNATIONAL";

export interface Competition {
  id: string;
  name: string;
  type: CompetitionType;
  countryCode: string | null;
  logoUrl: string | null;
  externalRef: unknown;
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
}
