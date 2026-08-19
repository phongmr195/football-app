// 5 giải quốc gia có hỗ trợ Sofascore trong soccerdata (verify thật — LEAGUE_DICT trong
// _config.py chỉ có key "Sofascore" cho đúng 5 giải này). UEFA Champions League KHÔNG có, để sau
// (cần tự viết league_dict.json override + verify read_schedule() hoạt động đúng với format vòng
// bảng/knockout khác giải quốc gia — chưa làm ở piece này).
//
// `dbName` đã verify khớp đúng Competition.name thật trong Postgres (provider football-data) — La
// Liga lưu trong DB là "Primera Division", KHÔNG PHẢI "La Liga".
export const SCRAPER_COMPETITIONS = {
  "premier-league": { label: "Premier League", dbName: "Premier League", sofascoreKey: "ENG-Premier League" },
  "la-liga": { label: "La Liga", dbName: "Primera Division", sofascoreKey: "ESP-La Liga" },
  bundesliga: { label: "Bundesliga", dbName: "Bundesliga", sofascoreKey: "GER-Bundesliga" },
  "serie-a": { label: "Serie A", dbName: "Serie A", sofascoreKey: "ITA-Serie A" },
  "ligue-1": { label: "Ligue 1", dbName: "Ligue 1", sofascoreKey: "FRA-Ligue 1" },
} as const;

export type ScraperCompetitionKey = keyof typeof SCRAPER_COMPETITIONS;

export const SCRAPER_COMPETITION_KEYS = Object.keys(SCRAPER_COMPETITIONS) as ScraperCompetitionKey[];

// football-data.org đặt tên season theo NĂM BẮT ĐẦU (Season.name vd "2025") — soccerdata cần format
// "2025-26". Xem CLAUDE.md § Scraper cho gotcha đầy đủ (season "current" thường KHÔNG phải season
// có match FINISHED để scrape — season vừa xong mới có).
export function toSofascoreSeasonString(dbSeasonName: string): string {
  const startYear = Number(dbSeasonName);
  const endYearShort = ((startYear + 1) % 100).toString().padStart(2, "0");
  return `${dbSeasonName}-${endYearShort}`;
}
