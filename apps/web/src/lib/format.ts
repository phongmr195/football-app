import type { BadgeVariant } from "@football-app/ui";
import type { CompetitionType, ExternalRef, MatchStatus } from "@/lib/types";

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

/** vi-VN formatted date, e.g. "17/09/1998" — used for a player's date of birth. */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Vietnamese label + Badge variant for a Player's position, seeded values from API-Football. */
export function playerPositionMeta(position: string | null): {
  label: string;
  variant: BadgeVariant;
} {
  switch (position) {
    case "Goalkeeper":
      return { label: "Thủ môn", variant: "warning" };
    case "Defender":
      return { label: "Hậu vệ", variant: "info" };
    case "Midfielder":
      return { label: "Tiền vệ", variant: "success" };
    case "Forward":
      return { label: "Tiền đạo", variant: "danger" };
    case "Attacker":
      return { label: "Tiền đạo", variant: "danger" };
    default:
      return { label: position ?? "Chưa rõ", variant: "default" };
  }
}
