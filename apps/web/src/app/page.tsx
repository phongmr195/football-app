import { Container } from "@football-app/ui";
import { Separator } from "@/components/ui/separator";
import { FavoritesDashboardSection } from "@/components/dashboard/FavoritesDashboardSection";
import { FeaturedCompetitionsBlock } from "@/components/dashboard/FeaturedCompetitionsBlock";
import { LiveMatchesTicker } from "@/components/dashboard/LiveMatchesTicker";
import { StandingsPreviewBlock } from "@/components/dashboard/StandingsPreviewBlock";
import { TopScorersPreviewBlock } from "@/components/dashboard/TopScorersPreviewBlock";
import { UpcomingMatchesBlock } from "@/components/dashboard/UpcomingMatchesBlock";
import { apiGet, type ApiListResponse } from "@/lib/api-client";
import { getFilterableCompetitions, pickDefaultCompetition, pickDefaultSeasonId } from "@/lib/default-selection";
import type { Match, Standing, TopAssistEntry, TopScorerEntry } from "@/lib/types";

// Bug thật gặp 2026-08-17 (CI build fail): `/` là trang DUY NHẤT trong app gọi apiGet() mà KHÔNG
// nhận searchParams — mọi trang browse khác (/matches, /standings, ...) nhận `searchParams`
// (1 dynamic API của Next.js App Router), tự động bị coi là dynamic nên Next.js không cố
// static-prerender chúng lúc `next build`. Trang này không có searchParams nào nên Next.js CỐ
// prerender lúc build — CI không có `apps/api` chạy thật (`API_URL` không set, xem
// .github/workflows/ci.yml), nên apiGet() throw ngay giữa lúc build, fail hẳn `next build`.
// `force-dynamic` tắt hẳn việc static-prerender trang này (luôn render lúc có request thật,
// giống hành vi thật sự các trang browse khác đã có sẵn nhờ searchParams) — đánh đổi mất cache
// ISR 5 phút để đổi lấy build không phụ thuộc API sống, chấp nhận được cho 1 trang chủ.
export const dynamic = "force-dynamic";

const PREVIEW_COUNT = 5;

export default async function Home() {
  const competitions = await getFilterableCompetitions();
  const defaultCompetition = pickDefaultCompetition(competitions);
  const seasonId = defaultCompetition ? await pickDefaultSeasonId(defaultCompetition.id) : undefined;

  // "Sắp diễn ra" KHÔNG khoá theo seasonId ở trên — mùa đó được chọn để có standings/scorers ĐẦY
  // ĐỦ NHẤT (ưu tiên mùa đã bắt đầu, xem pickDefaultSeasonId), nhưng 1 mùa đã hoàn tất thì đúng
  // ra sẽ có 0 trận SCHEDULED còn lại (bug thật gặp 2026-08-17: Premier League 2025/26 đã đá xong
  // hết 380 trận, trong khi mùa 2026/27 kế tiếp — chưa "bắt đầu" nên không được pickDefaultSeasonId
  // chọn — đã có sẵn lịch 380 trận SCHEDULED). Lọc theo competitionId thôi, không theo season, để
  // luôn bắt được trận SCHEDULED gần nhất bất kể nó thuộc mùa nào.
  const upcoming = defaultCompetition
    ? await apiGet<ApiListResponse<Match>>("/matches", {
        competitionId: defaultCompetition.id,
        status: "SCHEDULED",
        order: "asc",
        pageSize: PREVIEW_COUNT,
      }).then((r) => r.items)
    : [];

  const [standings, topScorers, topAssists] = seasonId
    ? await Promise.all([
        apiGet<{ items: Standing[] }>("/standings", { seasonId }).then((r) => r.items.slice(0, PREVIEW_COUNT)),
        apiGet<{ items: TopScorerEntry[] }>("/standings/top-scorers", { seasonId }).then((r) =>
          r.items.slice(0, PREVIEW_COUNT),
        ),
        apiGet<{ items: TopAssistEntry[] }>("/standings/top-assists", { seasonId }).then((r) =>
          r.items.slice(0, PREVIEW_COUNT),
        ),
      ])
    : [[], [], []];

  const standingsHref =
    defaultCompetition && seasonId
      ? `/standings?competitionId=${defaultCompetition.id}&seasonId=${seasonId}`
      : "/standings";

  return (
    <Container size="lg" className="flex flex-col gap-8 py-10">
      <LiveMatchesTicker />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Đội bóng yêu thích của bạn</h2>
        <FavoritesDashboardSection />
      </section>

      <Separator />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Các trận đấu sắp diễn ra</h2>
            {defaultCompetition ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{defaultCompetition.name}</span>
            ) : null}
          </div>
          <UpcomingMatchesBlock matches={upcoming} />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Bảng xếp hạng</h2>
            {defaultCompetition ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{defaultCompetition.name}</span>
            ) : null}
          </div>
          <StandingsPreviewBlock
            standings={standings}
            competitionId={defaultCompetition?.id}
            seasonId={seasonId}
          />
        </section>
      </div>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Thống kê cầu thủ</h2>
        <TopScorersPreviewBlock scorers={topScorers} assists={topAssists} standingsHref={standingsHref} />
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Giải đấu nổi bật</h2>
        <FeaturedCompetitionsBlock competitions={competitions.slice(0, 8)} />
      </section>
    </Container>
  );
}
