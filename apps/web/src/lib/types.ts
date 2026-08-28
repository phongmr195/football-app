/**
 * Local response types for apps/api's read-only browse endpoints (competitions/standings).
 *
 * These mirror the JSON shape apps/api actually returns (Prisma model fields, camelCase),
 * not packages/data-provider's canonical provider model (that's the sync-worker's internal
 * shape, pre-mapping). Kept local to apps/web for now — move to packages/shared if another
 * client ever needs the same shapes.
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

export interface PrimaryOdds {
  home: number;
  draw: number;
  away: number;
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
  // null khi chưa scrape odds cho match này, hoặc match đã FINISHED (loại khỏi batch tính ở
  // apps/api's attachPrimaryOdds — xem apps/api/src/routes/matches.ts).
  primaryOdds: PrimaryOdds | null;
  // Admin nhập tay — YouTube link thường hoặc URL HLS (.m3u8), xem components/match/LiveStreamPlayer.tsx.
  liveStreamUrl: string | null;
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

export interface AiMatchSummary {
  content: string;
  model: string;
  createdAt: string;
}

export interface MatchCommentAuthor {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  // @token dùng để tag user này (username hoặc slug từ displayName) — null nếu không tag được.
  mentionHandle: string | null;
}

export interface MatchComment {
  id: string;
  matchId: string;
  content: string;
  // User.id đã resolve — CHỈ gồm user đã từng comment trận này (xem apps/api/src/routes/match-comments.ts).
  mentionedUserIds: string[];
  createdAt: string;
  author: MatchCommentAuthor;
}

export interface MatchDetail extends Match {
  liveState: LiveMatchState | null;
  aiSummary: AiMatchSummary | null;
}

export type MatchEventType =
  | "GOAL"
  | "OWN_GOAL"
  | "PENALTY"
  | "YELLOW_CARD"
  | "RED_CARD"
  | "SUBSTITUTION"
  | "VAR";

export interface MatchEventPlayerRef {
  id: string;
  name: string;
}

/** Raw row shape returned by GET /matches/:id/events (see packages/database's MatchEvent model).
 * `player`/`relatedPlayer`/`team` là `null` khi ID tương ứng là `null` (vd thẻ cho HLV, không
 * phải cầu thủ — verify thật 2026-08-18) HOẶC khi scraper không khớp được tên cầu thủ. */
export interface MatchEvent {
  id: string;
  matchId: string;
  seq: number;
  minute: number;
  type: MatchEventType;
  teamId: string | null;
  playerId: string | null;
  relatedPlayerId: string | null;
  player: MatchEventPlayerRef | null;
  relatedPlayer: MatchEventPlayerRef | null;
  team: MatchEventPlayerRef | null;
  detail: unknown;
  createdAt: string;
}

/** GET /matches/:id/lineups — gộp MatchLineup + PlayerRating + Formation.formation phía API. */
export interface MatchLineupPlayer {
  playerId: string;
  name: string;
  position: string | null;
  shirtNumber: number | null;
  isStarting: boolean;
  rating: number | null;
}

export interface MatchLineupSide {
  teamId: string;
  formation: string | null;
  players: MatchLineupPlayer[];
}

export interface MatchLineupsResponse {
  home: MatchLineupSide;
  away: MatchLineupSide;
}

/**
 * GET /matches/:id/statistics — field đã model hoá (shotsOnGoal/corners/fouls/offsides) hầu hết
 * `null` trong data thật (scraper Sofascore) — số liệu thật nằm trong `raw.groups[]`, xem
 * MatchStatisticsBars.tsx cho cách render generic từ đó. `null` khi match chưa có statistics.
 */
export interface MatchStatisticSide {
  id: string;
  matchId: string;
  teamId: string;
  shotsOnGoal: number | null;
  shotsOffGoal: number | null;
  possession: number | null;
  corners: number | null;
  fouls: number | null;
  offsides: number | null;
  raw: unknown;
}

export interface MatchStatisticsResponse {
  home: MatchStatisticSide | null;
  away: MatchStatisticSide | null;
}

export interface MatchOddsItem {
  sofascoreMarketId: number;
  marketName: string;
  raw: unknown;
}

export interface MatchOddsResponse {
  items: MatchOddsItem[];
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
  // Shape giống AiMatchSummary ({content, model, createdAt}) — tái dùng type đã có thay vì tạo
  // interface riêng. `null` khi cầu thủ chưa có PlayerStatistics/chưa được backfill, xem
  // apps/sync-worker/src/player-summary.ts.
  aiSummary: AiMatchSummary | null;
}

/** POST /players/compare response (apps/api/src/routes/player-compare.ts). */
export interface PlayerCompareSide {
  id: string;
  name: string;
  position: string | null;
  team: { id: string; name: string; logoUrl: string | null } | null;
  statistics: Pick<
    PlayerStatistics,
    "appearances" | "goals" | "assists" | "yellowCards" | "redCards" | "minutesPlayed"
  > | null;
}

export interface PlayerCompareResponse {
  playerA: PlayerCompareSide;
  playerB: PlayerCompareSide;
  // Shape giống AiMatchSummary — tái dùng type đã có, đúng convention PlayerDetail.aiSummary.
  comparison: AiMatchSummary;
  cached: boolean;
}

/** GET /players/compare/history item (apps/api/src/routes/player-compare.ts) — lịch sử so sánh
 * của user, mới nhất trước. */
export interface PlayerCompareHistoryEntry {
  id: string;
  viewedAt: string;
  playerA: { id: string; name: string; team: { id: string; name: string; logoUrl: string | null } | null };
  playerB: { id: string; name: string; team: { id: string; name: string; logoUrl: string | null } | null };
  comparison: AiMatchSummary;
}

/** apps/api/src/routes/chat.ts — Chat AI (RAG-lite qua SQL retrieval, không embedding/pgvector). */
export type ChatMessageRole = "USER" | "ASSISTANT";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
}

export interface ChatSendResponse {
  sessionId: string;
  reply: { content: string; createdAt: string };
}

export interface ChatSessionSummary {
  sessionId: string;
  lastActivityAt: string;
  messageCount: number;
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

/** GET /search response shape (apps/api/src/routes/search.ts) — a small capped result set per
 * entity type, not a paginated list like the browse endpoints. */
export interface SearchPlayerItem extends Player {
  team: { id: string; name: string; logoUrl: string | null } | null;
}

export interface SearchResults {
  teams: Team[];
  players: SearchPlayerItem[];
  competitions: Competition[];
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

/** Shapes returned by GET /standings/top-scorers, /top-assists, /clean-sheets (Phase 3) — see
 * apps/api/src/routes/standings.ts and apps/sync-worker/src/sync-catalog.ts's syncTopScorers()/
 * syncTeamAggregates() for how these are derived. */
export interface StandingPlayer {
  id: string;
  name: string;
  position: string | null;
  team: StandingTeam | null;
}

export interface TopScorerEntry {
  id: string;
  rank: number;
  goals: number;
  player: StandingPlayer;
}

export interface TopAssistEntry {
  id: string;
  rank: number;
  assists: number;
  player: StandingPlayer;
}

export interface CleanSheetEntry {
  id: string;
  rank: number;
  count: number;
  team: StandingTeam;
}

/** GET /statistics/teams/:id and /statistics/players/:id (Phase 3) — no `seasonId` query param
 * means "most recent season with data", see apps/api/src/routes/statistics.ts. */
export interface TeamStatistics {
  id: string;
  teamId: string;
  seasonId: string;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
}

export interface PlayerStatistics {
  id: string;
  playerId: string;
  seasonId: string;
  appearances: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  minutesPlayed: number;
  /** Chỉ Sofascore's season top-players điền được (football-data.org's top-scorers không có) —
   * `rating !== null` là dấu hiệu ĐÁNG TIN CẬY nhất để biết row này đã được Sofascore enrich hay
   * chưa (yellowCards/redCards có @default(0) nên không tự phân biệt được "0 thẻ thật" với "chưa
   * có data" — xem apps/sync-worker/src/ingest-player-season-stats.ts). */
  rating: number | null;
  expectedGoals: number | null;
  expectedAssists: number | null;
  tackles: number | null;
  interceptions: number | null;
  keyPasses: number | null;
  successfulDribbles: number | null;
  kilometersCovered: number | null;
  topSpeed: number | null;
  saves: number | null;
  cleanSheet: number | null;
}

/** GET /notifications (apps/api/src/routes/notifications.ts) — thông báo CỦA CHÍNH user đang đăng
 * nhập (khác NotificationLog ở admin, vốn là log gửi theo mọi user). `data` là payload gốc gửi
 * kèm FCM push (xem goal-notifier.ts/match-finished-notifier.ts) — shape khác nhau theo `type`
 * ("goal" | "match_result"), không model hoá chặt ở đây vì UI hiện chỉ cần title/body hiển thị. */
export interface UserNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}
