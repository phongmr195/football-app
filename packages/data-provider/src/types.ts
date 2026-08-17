// Canonical model — hình dạng dữ liệu nội bộ của app, KHÔNG theo hình dạng JSON của provider.
// Mỗi provider (api-football, sportradar...) chỉ có nhiệm vụ map JSON thô của họ về đây.

export interface ExternalRef {
  provider: string;
  id: string;
}

export interface CanonicalCompetition {
  externalRef: ExternalRef;
  name: string;
  type: "LEAGUE" | "CUP" | "INTERNATIONAL";
  countryCode?: string;
  logoUrl?: string;
}

export interface CanonicalSeason {
  externalRef: ExternalRef;
  competitionExternalRef: ExternalRef;
  name: string;
  startDate: string; // ISO date
  endDate: string;
  isCurrent: boolean;
}

export interface CanonicalTeam {
  externalRef: ExternalRef;
  name: string;
  shortName?: string;
  logoUrl?: string;
  countryCode?: string;
  founded?: number;
}

export interface CanonicalPlayer {
  externalRef: ExternalRef;
  name: string;
  dateOfBirth?: string;
  nationality?: string;
  position?: string;
  teamExternalRef?: ExternalRef;
}

export type CanonicalMatchStatus =
  | "SCHEDULED"
  | "LIVE"
  | "HALFTIME"
  | "FINISHED"
  | "POSTPONED"
  | "CANCELLED";

export interface CanonicalMatch {
  externalRef: ExternalRef;
  competitionExternalRef: ExternalRef;
  seasonExternalRef: ExternalRef;
  homeTeamExternalRef: ExternalRef;
  awayTeamExternalRef: ExternalRef;
  kickoffAt: string; // ISO datetime
  status: CanonicalMatchStatus;
  minute?: number;
  homeScore?: number;
  awayScore?: number;
}

export type CanonicalMatchEventType =
  | "GOAL"
  | "OWN_GOAL"
  | "PENALTY"
  | "YELLOW_CARD"
  | "RED_CARD"
  | "SUBSTITUTION"
  | "VAR";

export interface CanonicalMatchEvent {
  matchExternalRef: ExternalRef;
  seq: number;
  minute: number;
  type: CanonicalMatchEventType;
  teamExternalRef?: ExternalRef;
  playerExternalRef?: ExternalRef;
  relatedPlayerExternalRef?: ExternalRef;
}

export interface CanonicalTopScorerRow {
  seasonExternalRef: ExternalRef;
  playerExternalRef: ExternalRef;
  teamExternalRef: ExternalRef;
  playedMatches: number;
  goals: number;
  assists: number;
}

export interface CanonicalStandingRow {
  seasonExternalRef: ExternalRef;
  teamExternalRef: ExternalRef;
  position: number;
  played: number;
  win: number;
  draw: number;
  loss: number;
  gf: number;
  ga: number;
  points: number;
}
