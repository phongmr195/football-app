import type { BadgeVariant } from "@football-app/ui";
import type { CompetitionType, MatchStatus } from "@/lib/types";

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
