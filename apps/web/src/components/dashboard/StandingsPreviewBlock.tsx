import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Standing } from "@/lib/types";

export interface StandingsPreviewBlockProps {
  standings: Standing[];
  competitionId?: string;
  seasonId?: string;
}

/** Top N rows of the default competition's standings, linking to the full table. Server-rendered
 * — same GET /standings call app/standings/page.tsx already makes, just sliced to a preview. */
export function StandingsPreviewBlock({ standings, competitionId, seasonId }: StandingsPreviewBlockProps) {
  if (standings.length === 0) {
    return (
      <Card className="px-4 py-4 text-sm text-zinc-500 dark:text-zinc-400">
        Chưa có dữ liệu bảng xếp hạng.
      </Card>
    );
  }

  const href =
    competitionId && seasonId ? `/standings?competitionId=${competitionId}&seasonId=${seasonId}` : "/standings";

  // py-0 overrides Card's own baked-in vertical padding (--card-spacing) — table rows and the
  // "Xem đầy đủ" link manage their own spacing instead, same "no default padding" need the old
  // @football-app/ui Card covered via `padding="none"` (shadcn's Card has no such prop).
  return (
    <Card className="py-0">
      <table className="w-full text-sm">
        <tbody>
          {standings.map((row) => (
            <tr key={row.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
              <td className="w-8 px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{row.position}</td>
              <td className="px-2 py-2">
                <Link href={`/teams/${row.team.id}`} className="flex items-center gap-2 hover:underline">
                  {row.team.logoUrl ? (
                    <Image src={row.team.logoUrl} alt="" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
                  ) : null}
                  <span className="truncate text-zinc-900 dark:text-zinc-50">{row.team.name}</span>
                </Link>
              </td>
              <td className="px-4 py-2 text-right font-semibold text-zinc-900 dark:text-zinc-50">
                {row.points}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link
        href={href}
        className="flex items-center justify-center gap-1 border-t border-zinc-100 px-4 py-2 text-sm text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
      >
        Xem đầy đủ
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </Card>
  );
}
