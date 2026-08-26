import type { BadgeVariant } from "@football-app/ui";
import type { CompetitionType, ExternalRef, MatchEvent, MatchEventType, MatchResult, MatchStatus } from "@/lib/types";

/** Circle symbol + color for a MatchResult (WIN/DRAW/LOSS), used in standings "form" strips. */
export function matchResultMeta(result: MatchResult): { symbol: string; className: string } {
  switch (result) {
    case "WIN":
      return { symbol: "✓", className: "bg-emerald-500 text-white" };
    case "DRAW":
      return {
        symbol: "–",
        className: "bg-zinc-300 text-zinc-700 dark:bg-zinc-600 dark:text-zinc-100",
      };
    case "LOSS":
      return { symbol: "✕", className: "bg-red-500 text-white" };
  }
}

/**
 * Data providers sometimes use a competition's official/legal name rather than its popular
 * commercial name — e.g. football-data.org names Spain's top league "Primera Division"
 * (id 2014), not "La Liga" (a brand name adopted ~2016). This is accurate provider data, not
 * a bug — the override here is purely a display-layer rename, the stored name/DB row is
 * untouched. Keyed by `${externalRef.provider}:${externalRef.id}`, NOT by name — "Primera
 * Division" alone collides with El Salvador/Guatemala/Nicaragua/Cuba's leagues (verified via
 * psql), so a name-only lookup would have mislabeled those too.
 */
const COMPETITION_DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  "football-data:2014": "La Liga",
};

/** Display name for a competition, applying COMPETITION_DISPLAY_NAME_OVERRIDES if one exists. */
export function competitionDisplayName(competition: { name: string; externalRef: ExternalRef }): string {
  const key = `${competition.externalRef.provider}:${competition.externalRef.id}`;
  return COMPETITION_DISPLAY_NAME_OVERRIDES[key] ?? competition.name;
}

/** Vietnamese label + Badge variant for a CompetitionType, for consistent display. */
export function competitionTypeMeta(type: CompetitionType): {
  label: string;
  variant: BadgeVariant;
} {
  switch (type) {
    case "LEAGUE":
      return { label: "Giải vô địch", variant: "info" };
    case "CUP":
      return { label: "Cúp", variant: "warning" };
    case "INTERNATIONAL":
      return { label: "Quốc tế", variant: "success" };
    default:
      return { label: type, variant: "default" };
  }
}

/** Vietnamese label + Badge variant for a MatchStatus, for consistent display. */
export function matchStatusMeta(status: MatchStatus): {
  label: string;
  variant: BadgeVariant;
} {
  switch (status) {
    case "SCHEDULED":
      return { label: "Sắp diễn ra", variant: "info" };
    case "LIVE":
      return { label: "Trực tiếp", variant: "danger" };
    case "HALFTIME":
      return { label: "Nghỉ giữa giờ", variant: "warning" };
    case "FINISHED":
      return { label: "Đã kết thúc", variant: "default" };
    case "POSTPONED":
      return { label: "Tạm hoãn", variant: "warning" };
    case "CANCELLED":
      return { label: "Đã hủy", variant: "danger" };
    default:
      return { label: status, variant: "default" };
  }
}

/** Vietnamese label for a MatchEventType, used in LiveMatchPanel's events list. */
export function matchEventTypeLabel(type: MatchEventType): string {
  switch (type) {
    case "GOAL":
      return "Bàn thắng";
    case "OWN_GOAL":
      return "Phản lưới nhà";
    case "PENALTY":
      return "Phạt đền";
    case "YELLOW_CARD":
      return "Thẻ vàng";
    case "RED_CARD":
      return "Thẻ đỏ";
    case "SUBSTITUTION":
      return "Thay người";
    case "VAR":
      return "VAR";
    default:
      return type;
  }
}

/**
 * Nhãn đầy đủ cho 1 MatchEvent, gồm cả tên cầu thủ/đội — trước đây `MatchEventsTimeline`/
 * `LiveMatchPanel` chỉ hiện `matchEventTypeLabel(event.type)` (vd "Bàn thắng") mà KHÔNG hiện tên
 * cầu thủ, dù API đã trả `player`/`relatedPlayer`/`team` (bug thật, verify 2026-08-18 — dữ liệu
 * ghi đúng playerId ở scraper, chỉ là chưa render). `player`/`relatedPlayer` có thể `null` (vd thẻ
 * cho HLV thay vì cầu thủ, hoặc scraper không khớp được tên) — luôn fallback về nhãn gốc.
 */
export function formatMatchEventLabel(event: MatchEvent): string {
  const base = matchEventTypeLabel(event.type);
  const team = event.team ? ` (${event.team.name})` : "";

  let detail = "";
  if (event.type === "SUBSTITUTION") {
    const out = event.relatedPlayer?.name;
    const in_ = event.player?.name;
    if (out && in_) detail = `: ${out} ra, ${in_} vào sân`;
    else if (in_) detail = `: ${in_} vào sân`;
  } else if (event.player) {
    const assist = event.relatedPlayer ? ` (kiến tạo: ${event.relatedPlayer.name})` : "";
    detail = `: ${event.player.name}${assist}`;
  }

  return `${base}${detail}${team}`;
}

export interface GoalScorerEntry {
  id: string;
  minute: number;
  playerName: string;
  isOwnGoal: boolean;
  isPenalty: boolean;
}

/**
 * Nhóm các MatchEvent loại ghi bàn (GOAL/PENALTY/OWN_GOAL) theo đội home/away, dùng cho phần tóm
 * tắt "ai ghi bàn phút mấy" dưới tên đội ở score header (match detail page). Event thiếu `player`
 * (scraper không khớp được tên, hoặc thẻ cho HLV) bị bỏ qua — không có tên để hiện.
 *
 * OWN_GOAL: `event.teamId` là đội CỦA CẦU THỦ đá phản lưới (đội bị thiệt điểm), KHÔNG PHẢI đội
 * được cộng bàn — xem CLAUDE.md § Scraper's own-goal `isHome` note (map_events()/map_shotmap()
 * trong scraper.py cùng quy ước này). Verify thật qua DB 2026-08-23: Malo Gusto (Chelsea) đá phản
 * lưới nhà, event.team = "Chelsea FC" nhưng bàn thắng tính cho Sunderland (đối thủ) — vì vậy phải
 * ĐẢO NGƯỢC cột hiện thị so với GOAL/PENALTY bình thường.
 */
export function groupGoalScorersByTeam(
  events: MatchEvent[],
  homeTeamId: string,
): { home: GoalScorerEntry[]; away: GoalScorerEntry[] } {
  const home: GoalScorerEntry[] = [];
  const away: GoalScorerEntry[] = [];

  for (const event of events) {
    if (event.type !== "GOAL" && event.type !== "PENALTY" && event.type !== "OWN_GOAL") continue;
    if (!event.player || !event.teamId) continue;

    const isOwnGoal = event.type === "OWN_GOAL";
    const scoresForHomeTeam = isOwnGoal ? event.teamId !== homeTeamId : event.teamId === homeTeamId;

    (scoresForHomeTeam ? home : away).push({
      id: event.id,
      minute: event.minute,
      playerName: event.player.name,
      isOwnGoal,
      isPenalty: event.type === "PENALTY",
    });
  }

  home.sort((a, b) => a.minute - b.minute);
  away.sort((a, b) => a.minute - b.minute);
  return { home, away };
}

/** vd "45' Nguyễn Văn A (p)" — "(p)" cho phạt đền, "(OG)" cho phản lưới nhà, quy ước phổ biến. */
export function formatGoalScorerLabel(entry: GoalScorerEntry): string {
  const suffix = entry.isOwnGoal ? " (OG)" : entry.isPenalty ? " (p)" : "";
  return `${entry.minute}' ${entry.playerName}${suffix}`;
}

/** vi-VN formatted kickoff date/time, e.g. "21:00, 11/08/2023". */
export function formatKickoffAt(kickoffAt: string): string {
  const date = new Date(kickoffAt);
  const datePart = date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${timePart}, ${datePart}`;
}

/** Season display range from its start/end dates, e.g. "2025/2026" or "2026" if same year. */
export function formatSeasonRange(startDate: string, endDate: string): string {
  const start = new Date(startDate).getFullYear();
  const end = new Date(endDate).getFullYear();
  return start === end ? `${start}` : `${start}/${end}`;
}

/** vi-VN formatted date, e.g. "17/09/1998" — used for a player's date of birth. */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Vietnamese label + Badge variant for a Player's position. 2 provider dùng 2 vocabulary khác
 * hẳn nhau cho cùng nhóm vị trí (verify thật qua psql, 2026-08-17): API-Football dùng tên đầy đủ
 * ("Goalkeeper"/"Defender"/"Midfielder"/"Forward"/"Attacker"), football-data.org dùng tên
 * chuyên biệt hơn + nhóm rộng ("Defence"/"Midfield"/"Offence"/"Goalkeeper" + "Centre-Back",
 * "Right-Back", "Left-Back", "Central Midfield", "Defensive Midfield", "Attacking Midfield",
 * "Right Midfield", "Left Midfield", "Centre-Forward", "Right Winger", "Left Winger") — gộp cả 2
 * vào cùng 4 nhóm hiển thị (Thủ môn/Hậu vệ/Tiền vệ/Tiền đạo) thay vì hiện raw string không dịch.
 */
export function playerPositionMeta(position: string | null): {
  label: string;
  variant: BadgeVariant;
} {
  switch (position) {
    case "Goalkeeper":
    case "G": // Sofascore (apps/scraper-sofascore) dùng mã 1 ký tự, khác tên đầy đủ của football-data.org/api-football
      return { label: "Thủ môn", variant: "warning" };
    case "Defender":
    case "Defence":
    case "Centre-Back":
    case "Right-Back":
    case "Left-Back":
    case "D":
      return { label: "Hậu vệ", variant: "info" };
    case "Midfielder":
    case "Midfield":
    case "Central Midfield":
    case "Defensive Midfield":
    case "Attacking Midfield":
    case "Right Midfield":
    case "Left Midfield":
    case "M":
      return { label: "Tiền vệ", variant: "success" };
    case "Forward":
    case "Attacker":
    case "Offence":
    case "Centre-Forward":
    case "Right Winger":
    case "Left Winger":
    case "F":
      return { label: "Tiền đạo", variant: "danger" };
    default:
      return { label: position ?? "Chưa rõ", variant: "default" };
  }
}

const FIRST_HALF_MINUTES = 45;
const HALFTIME_BREAK_MINUTES = 15;

/**
 * Ước lượng số phút của trận đang LIVE khi provider không trả `minute` thật. Verify thật
 * 2026-08-23: `FootballDataAdapter` (provider mặc định, xem CLAUDE.md § Data provider) không có
 * field minute/elapsed nào trong response `/matches/{id}` — chỉ có `status`, đã confirm qua request
 * thật lúc có trận live (trước đó session viết `mapMatch()` chưa verify được vì lúc đó không có
 * trận nào live). `ApiFootballAdapter` THÌ có elapsed thật (`fixture.status.elapsed`) — vì vậy đây
 * CHỈ là fallback khi `liveState.minute` đã `null`, không dùng thay real data khi có.
 *
 * Model 2 hiệp cố định (45' + nghỉ 15' + 45') vì không có cách nào biết thời điểm hiệp 2 thật sự
 * bắt đầu (provider không cho biết): trong bù giờ hiệp 1 (đã qua 45' nhưng status vẫn LIVE, chưa
 * chuyển HALFTIME) hiện đứng ở 45' (không đoán số bù giờ thật); tương tự đứng ở 90' trong bù giờ
 * hiệp 2. Không chính xác 100% (không biết bù giờ thật/hiệp 2 có bắt đầu sớm-muộn hơn 15' nghỉ hay
 * không) nhưng đây là cách hầu hết app hiển thị "phút live" khi provider free tier không cho elapsed
 * thật — người dùng đã được thông báo và chấp nhận trade-off này.
 */
export function estimateLiveMinute(kickoffAt: string, now: number = Date.now()): number | null {
  const elapsedMinutes = Math.floor((now - new Date(kickoffAt).getTime()) / 60_000);
  if (elapsedMinutes < 0) return null; // Chưa tới kickoff thật (clock lệch/data trễ) — không đoán bậy.
  if (elapsedMinutes <= FIRST_HALF_MINUTES) return elapsedMinutes;
  if (elapsedMinutes <= FIRST_HALF_MINUTES + HALFTIME_BREAK_MINUTES) return FIRST_HALF_MINUTES;
  return Math.min(90, elapsedMinutes - HALFTIME_BREAK_MINUTES);
}
