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
