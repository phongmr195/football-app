import { apiGet, type ApiListResponse } from "@/lib/api-client";
import type { Competition, CompetitionDetail } from "@/lib/types";

// Provider mặc định hiện tại của sync-worker (xem CLAUDE.md § Data provider) — cùng 1 giải
// thật có thể có 2 row (1 mỗi provider, vd Premier League từ api-football lẫn từ
// football-data) nếu cả 2 đều được sync match data. Lọc theo provider này để dropdown filter
// không hiện trùng tên giải, và để chọn default competition/season nhất quán với data mới nhất.
// Dùng chung giữa /matches và /standings — xem matches/page.tsx và standings/page.tsx.
export const DEFAULT_PROVIDER = "football-data";

/** Competitions that actually have synced matches, for competition filter dropdowns. */
export async function getFilterableCompetitions(): Promise<Competition[]> {
  const { items } = await apiGet<ApiListResponse<Competition>>("/competitions", {
    hasMatches: true,
    provider: DEFAULT_PROVIDER,
    pageSize: 50,
  });
  return items;
}

/** competitionId not chosen by the user yet — pick a sensible default from the filterable list. */
export function pickDefaultCompetition(competitions: Competition[]): Competition | undefined {
  return competitions.find((c) => c.name === "Premier League") ?? competitions[0];
}

/** seasonId not chosen by the user yet — pick the current season, else the most recent one. */
export async function pickDefaultSeasonId(competitionId: string): Promise<string | undefined> {
  const detail = await apiGet<CompetitionDetail>(`/competitions/${competitionId}`);
  // seasons đã sắp xếp startDate desc từ API — items[0] chính là mùa gần nhất nếu không có
  // mùa nào isCurrent (ví dụ giải đã kết thúc hẳn, không còn mùa "đang diễn ra").
  const season = detail.seasons.find((s) => s.isCurrent) ?? detail.seasons[0];
  return season?.id;
}
