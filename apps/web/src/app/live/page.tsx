import Image from "next/image";
import Link from "next/link";
import { Radio } from "lucide-react";
import { Badge, Card, Container } from "@football-app/ui";
import { apiGet } from "@/lib/api-client";
import { competitionDisplayName, formatKickoffAt, matchStatusMeta } from "@/lib/format";
import type { Match } from "@/lib/types";

// Match LIVE/HALFTIME/SCHEDULED có link, đổi khá thường xuyên (admin thêm/xoá link, trận chuyển
// LIVE) — dynamic (không phải ISR revalidate ngắn) vì: (1) đúng nhất cho dữ liệu đổi liên tục,
// (2) khớp convention các trang browse khác (matches/page.tsx, competitions/[id] — đều dynamic
// vì đọc searchParams/params). "/live" không có param nào nên KHÔNG tự động dynamic như các trang
// đó — không khai báo tường minh sẽ bị Next.js coi là static, tự gọi apiGet() lúc BUILD TIME thay
// vì request time, và build sẽ FAIL nếu API_URL không có sẵn lúc build (bug thật gặp 2026-08-26 —
// "/live" là trang DUY NHẤT trong app expose lỗ hổng này vì là trang duy nhất bị static hoá).
export const dynamic = "force-dynamic";

async function getLiveStreamMatches(): Promise<Match[]> {
  const { items } = await apiGet<{ items: Match[] }>("/matches/live-streams");
  return items;
}

export default async function LivePage() {
  const matches = await getLiveStreamMatches();

  return (
    <Container size="lg" className="py-10">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        <Radio className="h-6 w-6" aria-hidden="true" />
        Trực tiếp
      </h1>

      {matches.length === 0 ? (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          Hiện chưa có trận đấu nào có link trực tiếp.
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {matches.map((match) => {
            const { label, variant } = matchStatusMeta(match.status);
            const isLive = match.status === "LIVE" || match.status === "HALFTIME";
            const competitionName = competitionDisplayName(match.competition);

            return (
              <li key={match.id}>
                <Link href={`/matches/${match.id}`}>
                  <Card className="flex flex-col gap-3 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                    <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                      <div className="flex items-center gap-2">
                        {match.competition.logoUrl ? (
                          <Image
                            src={match.competition.logoUrl}
                            alt={competitionName}
                            width={16}
                            height={16}
                            className="h-4 w-4 object-contain"
                          />
                        ) : null}
                        <span>{competitionName}</span>
                      </div>
                      <span className="flex items-center gap-1.5">
                        {isLive ? <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" /> : null}
                        <Badge variant={variant}>{label}</Badge>
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-1 items-center gap-2">
                        {match.homeTeam.logoUrl ? (
                          <Image
                            src={match.homeTeam.logoUrl}
                            alt={match.homeTeam.name}
                            width={24}
                            height={24}
                            className="h-6 w-6 object-contain"
                          />
                        ) : (
                          <div className="h-6 w-6 rounded bg-zinc-100 dark:bg-zinc-800" />
                        )}
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                          {match.homeTeam.name}
                        </span>
                      </div>

                      <span className="shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {isLive && match.homeScore !== null && match.awayScore !== null
                          ? `${match.homeScore} - ${match.awayScore}`
                          : formatKickoffAt(match.kickoffAt)}
                      </span>

                      <div className="flex flex-1 items-center justify-end gap-2 text-right">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                          {match.awayTeam.name}
                        </span>
                        {match.awayTeam.logoUrl ? (
                          <Image
                            src={match.awayTeam.logoUrl}
                            alt={match.awayTeam.name}
                            width={24}
                            height={24}
                            className="h-6 w-6 object-contain"
                          />
                        ) : (
                          <div className="h-6 w-6 rounded bg-zinc-100 dark:bg-zinc-800" />
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
