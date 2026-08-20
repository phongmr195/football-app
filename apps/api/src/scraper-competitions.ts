// 5 giải quốc gia có hỗ trợ Sofascore trong soccerdata (verify thật — LEAGUE_DICT trong
// _config.py chỉ có key "Sofascore" cho đúng 5 giải này). UEFA Champions League KHÔNG có, để sau
// (cần tự viết league_dict.json override + verify read_schedule() hoạt động đúng với format vòng
// bảng/knockout khác giải quốc gia — chưa làm ở piece này).
//
// `externalRefId` — id football-data.org THẬT (ổn định, KHÔNG đổi) — KHÔNG dùng `Competition.name`
// để match nữa (bug thật đã gặp 2026-08-20: admin đổi tên hiển thị "Primera Division" -> "Laliga"
// qua /admin/competitions, lookup theo tên cũ ("dbName") lập tức mất khớp — trang scraper hiện
// "Chọn mùa" rỗng cho La Liga vì resolveCompetition() không tìm thấy competition nào tên khớp,
// và nếu tạo được run thì scraper-orchestrator.ts cũng fail vì cùng lý do). `name` là field admin
// SỬA ĐƯỢC qua CRUD, không bao giờ nên dùng làm khoá lookup ổn định — id provider mới đúng vai đó
// (xem CLAUDE.md § Database's nguyên tắc externalRef).
export const SCRAPER_COMPETITIONS = {
  "premier-league": { label: "Premier League", externalRefId: "2021", sofascoreKey: "ENG-Premier League" },
  "la-liga": { label: "La Liga", externalRefId: "2014", sofascoreKey: "ESP-La Liga" },
  bundesliga: { label: "Bundesliga", externalRefId: "2002", sofascoreKey: "GER-Bundesliga" },
  "serie-a": { label: "Serie A", externalRefId: "2019", sofascoreKey: "ITA-Serie A" },
  "ligue-1": { label: "Ligue 1", externalRefId: "2015", sofascoreKey: "FRA-Ligue 1" },
} as const;

export type ScraperCompetitionKey = keyof typeof SCRAPER_COMPETITIONS;

// Đọc an toàn field `id` từ Competition.externalRef (Prisma Json, hình dạng thật luôn
// `{ provider: string, id: string }` — xem packages/data-provider/src/types.ts's ExternalRef,
// KHÔNG import package đó vào apps/api chỉ để lấy 1 type, tự khai báo tối thiểu ở đây).
export function readExternalRefId(externalRef: unknown): string | null {
  if (typeof externalRef !== "object" || externalRef === null) return null;
  const id = (externalRef as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

export const SCRAPER_COMPETITION_KEYS = Object.keys(SCRAPER_COMPETITIONS) as ScraperCompetitionKey[];

// football-data.org đặt tên season theo NĂM BẮT ĐẦU (Season.name vd "2025") — soccerdata cần format
// "2025-26". Xem CLAUDE.md § Scraper cho gotcha đầy đủ (season "current" thường KHÔNG phải season
// có match FINISHED để scrape — season vừa xong mới có).
export function toSofascoreSeasonString(dbSeasonName: string): string {
  const startYear = Number(dbSeasonName);
  const endYearShort = ((startYear + 1) % 100).toString().padStart(2, "0");
  return `${dbSeasonName}-${endYearShort}`;
}

// 10 loại data admin chọn được ở trang scraper — 3 loại cũ (events/lineups/statistics, cố định từ
// piece đầu) + 6 loại match-level (verify thật 2026-08-19, xem CLAUDE.md § Scraper cho inventory
// đầy đủ đã probe từ Sofascore) + 1 loại SEASON-level (playerSeasonStats, 2026-08-20 — khác hẳn 9
// loại trên: 1 lần fetch/mùa giải, KHÔNG theo từng match, xem scraper-orchestrator.ts's
// runPlayerSeasonStatsPipeline()). Key này dùng CHUNG cho: Zod validation ở admin-scraper.ts, CLI
// arg `--data-types` truyền xuống generate-sofascore-manifest.ts/scraper.py cho 9 loại match-level
// (string y hệt, KHÔNG qua mapping riêng) — `playerSeasonStats` KHÔNG đi qua đường đó, orchestrator
// tự lọc riêng.
export const SCRAPER_DATA_TYPES = {
  events: "Events (diễn biến)",
  lineups: "Lineups + Ratings (đội hình)",
  statistics: "Statistics (thống kê trận)",
  commentary: "Commentary (bình luận theo phút)",
  shotmap: "Shotmap (bản đồ cú sút, xG)",
  highlights: "Highlights (link video)",
  averagePositions: "Average positions (vị trí trung bình)",
  momentum: "Momentum graph (biểu đồ áp lực trận)",
  odds: "Odds (tỉ lệ cược — admin-only, chưa hiển thị public)",
  playerSeasonStats: "Player season stats (chỉ số nâng cao cả mùa — rating/xG/xA/thẻ/...)",
} as const;

export type ScraperDataType = keyof typeof SCRAPER_DATA_TYPES;

export const SCRAPER_DATA_TYPE_KEYS = Object.keys(SCRAPER_DATA_TYPES) as ScraperDataType[];

// 3 loại cũ — default cho ScraperRun.dataTypes ở schema.prisma, và fallback nếu client cũ (chưa
// cập nhật UI) không gửi field này.
export const DEFAULT_SCRAPER_DATA_TYPES: ScraperDataType[] = ["events", "lineups", "statistics"];
