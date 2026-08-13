import type { BadgeVariant } from "@football-app/ui";
import type { CompetitionType } from "@/lib/types";

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
