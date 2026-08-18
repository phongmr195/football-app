import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Footprints, Target, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { TopAssistEntry, TopScorerEntry } from "@/lib/types";

export interface TopScorersPreviewBlockProps {
  scorers: TopScorerEntry[];
  assists: TopAssistEntry[];
  standingsHref: string;
}

/** Server-rendered top-N preview of GET /standings/top-scorers + /top-assists (Phase 3), each
 * linking to the corresponding tab on the full /standings page. */
export function TopScorersPreviewBlock({ scorers, assists, standingsHref }: TopScorersPreviewBlockProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <PreviewList
        title="Vua phá lưới"
        titleIcon={Target}
        href={`${standingsHref}&tab=scorers`}
        rows={scorers.map((s) => ({
          id: s.id,
          rank: s.rank,
          name: s.player.name,
          logoUrl: s.player.team?.logoUrl ?? null,
          value: `${s.goals} bàn`,
          href: `/players/${s.player.id}`,
        }))}
      />
      <PreviewList
        title="Kiến tạo"
        titleIcon={Footprints}
        href={`${standingsHref}&tab=assists`}
        rows={assists.map((a) => ({
          id: a.id,
          rank: a.rank,
          name: a.player.name,
          logoUrl: a.player.team?.logoUrl ?? null,
          value: `${a.assists} kiến tạo`,
          href: `/players/${a.player.id}`,
        }))}
      />
    </div>
  );
}

interface PreviewRow {
  id: string;
  rank: number;
  name: string;
  logoUrl: string | null;
  value: string;
  href: string;
}

function PreviewList({
  title,
  titleIcon: TitleIcon,
  href,
  rows,
}: {
  title: string;
  titleIcon: LucideIcon;
  href: string;
  rows: PreviewRow[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
        <TitleIcon className="h-4 w-4" aria-hidden="true" />
        {title}
      </h3>
      {rows.length === 0 ? (
        <Card className="px-4 py-4 text-sm text-zinc-500 dark:text-zinc-400">Chưa có dữ liệu.</Card>
      ) : (
        <Card className="py-0">
          {rows.map((row, index) => (
            <Link
              key={row.id}
              href={row.href}
              className={
                "flex items-center gap-3 px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900" +
                (index < rows.length - 1 ? " border-b border-zinc-100 dark:border-zinc-900" : "")
              }
            >
              <span className="w-4 text-center text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                {row.rank}
              </span>
              {row.logoUrl ? (
                <Image src={row.logoUrl} alt="" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
              ) : null}
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-50">{row.name}</span>
              <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{row.value}</span>
            </Link>
          ))}
        </Card>
      )}
      <Link
        href={href}
        className="flex items-center justify-center gap-0.5 text-center text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        Xem đầy đủ
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}
