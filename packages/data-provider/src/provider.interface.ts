import type {
  CanonicalMatch,
  CanonicalMatchEvent,
  CanonicalStandingRow,
  ExternalRef,
} from "./types";

// Interface chung mọi adapter phải implement — sync-worker chỉ phụ thuộc vào interface này,
// không biết provider cụ thể là gì. Đổi provider = viết adapter mới, không đụng downstream.
export interface DataProviderAdapter {
  readonly providerName: string;

  fetchLiveMatches(): Promise<CanonicalMatch[]>;
  fetchMatch(externalId: string): Promise<CanonicalMatch>;
  fetchMatchEvents(externalId: string): Promise<CanonicalMatchEvent[]>;
  fetchStandings(seasonExternalRef: ExternalRef): Promise<CanonicalStandingRow[]>;
}
