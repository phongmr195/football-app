import type {
  CanonicalCompetition,
  CanonicalMatch,
  CanonicalMatchEvent,
  CanonicalPlayer,
  CanonicalSeason,
  CanonicalStandingRow,
  CanonicalTeam,
  CanonicalTopScorerRow,
  ExternalRef,
} from "./types";

// Interface chung mọi adapter phải implement — sync-worker chỉ phụ thuộc vào interface này,
// không biết provider cụ thể là gì. Đổi provider = viết adapter mới, không đụng downstream.
export interface DataProviderAdapter {
  readonly providerName: string;

  fetchCompetitions(): Promise<CanonicalCompetition[]>;
  fetchSeasons(competitionExternalRef: ExternalRef): Promise<CanonicalSeason[]>;
  fetchTeams(
    competitionExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalTeam[]>;
  fetchPlayers(
    teamExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalPlayer[]>;
  fetchMatches(
    competitionExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalMatch[]>;
  fetchLiveMatches(): Promise<CanonicalMatch[]>;
  fetchMatch(externalId: string): Promise<CanonicalMatch>;
  fetchMatchEvents(externalId: string): Promise<CanonicalMatchEvent[]>;
  fetchStandings(
    competitionExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalStandingRow[]>;
  // Danh sách cầu thủ ghi bàn nhiều nhất (kèm assists/playedMatches) — nguồn cho cả
  // TopScorer/TopAssist/PlayerStatistics(appearances,goals,assists), xem sync-catalog.ts's
  // syncTopScorers(). Không phải mọi provider có endpoint này (xem ApiFootballAdapter).
  fetchTopScorers(
    competitionExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalTopScorerRow[]>;
}
