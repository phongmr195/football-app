// Whitelist 6 giải lớn cho phép đồng bộ tay từ /admin/data-sync — KHÔNG cho phép chọn tự do từ
// toàn bộ Competition trong DB. Lý do thật: syncAll() (chạy tay qua CLI hôm nay để fix La Liga
// 2026-27) tự gọi syncCompetitions() trước, fetch TOÀN BỘ /competitions của football-data.org
// (không chỉ 13 giải free-tier có data thật, xem CLAUDE.md § Data provider) — 189 competition row
// (đa số chỉ có metadata, KHÔNG sync được team/player/match vì free tier chặn) bị tạo ra ngoài ý
// muốn. Trang admin không nên cho chọn tự do giữa 189 dòng đó — chỉ 6 giải admin thật sự cần theo
// dõi mới hiện trong dropdown.
//
// `externalRefId` — id football-data.org THẬT (ổn định) — KHÔNG dùng Competition.name để match
// (tên hiển thị admin sửa được qua CRUD, xem cùng lý do ở scraper-competitions.ts).
export const SYNC_COMPETITIONS = {
  "premier-league": { label: "Premier League (EPL)", externalRefId: "2021" },
  "la-liga": { label: "La Liga", externalRefId: "2014" },
  "serie-a": { label: "Serie A", externalRefId: "2019" },
  bundesliga: { label: "Bundesliga", externalRefId: "2002" },
  "ligue-1": { label: "Ligue 1", externalRefId: "2015" },
  "champions-league": { label: "UEFA Champions League (C1)", externalRefId: "2001" },
} as const;

export type SyncCompetitionKey = keyof typeof SYNC_COMPETITIONS;

export const SYNC_COMPETITION_KEYS = Object.keys(SYNC_COMPETITIONS) as SyncCompetitionKey[];
