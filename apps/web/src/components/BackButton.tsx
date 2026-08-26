"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@football-app/ui";

/**
 * "Quay lại" button for detail pages (team/player/match/competition/standings) — goes back
 * to whatever the user actually came from (browser history), not a hardcoded parent route,
 * since these pages are linked from several different places (standings table, roster,
 * matches list, favorites...). Needs router.back(), hence a small client island — the detail
 * pages themselves stay Server Components (ISR), same pattern as FavoriteButton.
 */
export function BackButton() {
  const router = useRouter();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => router.back()}
      className="mb-4 -ml-3 gap-1"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Quay lại
    </Button>
  );
}
