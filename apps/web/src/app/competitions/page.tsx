import Image from "next/image";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { Badge, Card, Container, Pagination } from "@football-app/ui";
import { apiGet, type ApiListResponse } from "@/lib/api-client";
import { CompetitionFilters } from "@/components/CompetitionFilters";
import { competitionDisplayName, competitionTypeMeta } from "@/lib/format";
import type { Competition } from "@/lib/types";

// Competition catalog rarely changes — long ISR window is fine.
export const revalidate = 3600;

async function getCompetitions(page: number, search?: string, countryCode?: string) {
  return apiGet<ApiListResponse<Competition>>("/competitions", { page, search, countryCode });
}

async function getCountries() {
  const { items } = await apiGet<{ items: string[] }>("/competitions/countries");
  return items;
}

function buildHref(params: { page?: number; search?: string; countryCode?: string }): string {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set("search", params.search);
  if (params.countryCode) searchParams.set("countryCode", params.countryCode);
  if (params.page && params.page > 1) searchParams.set("page", String(params.page));
  const query = searchParams.toString();
  return query ? `/competitions?${query}` : "/competitions";
}

export default async function CompetitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; countryCode?: string }>;
}) {
  const { page: pageParam, search, countryCode } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const hasFilters = Boolean(search || countryCode);

  const [{ items, pageSize, total }, countries] = await Promise.all([
    getCompetitions(page, search, countryCode),
    getCountries(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Container size="lg" className="py-10">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          <Trophy className="h-6 w-6" aria-hidden="true" />
          Giải đấu
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {total.toLocaleString("vi-VN")} giải đấu &middot; Trang {page}/{totalPages}
        </p>
      </div>

      <CompetitionFilters countries={countries} />

      {items.length === 0 ? (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          {hasFilters
            ? "Không tìm thấy giải đấu nào khớp với bộ lọc hiện tại."
            : "Không có giải đấu nào."}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((competition) => {
            const { label, variant } = competitionTypeMeta(competition.type);
            const displayName = competitionDisplayName(competition);
            return (
              <Link key={competition.id} href={`/competitions/${competition.id}`}>
                <Card className="flex h-full flex-col gap-3 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                  <div className="flex items-center gap-3">
                    {competition.logoUrl ? (
                      <Image
                        src={competition.logoUrl}
                        alt={displayName}
                        width={40}
                        height={40}
                        className="h-10 w-10 object-contain"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-zinc-100 dark:bg-zinc-800" />
                    )}
                    <div className="flex flex-col">
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        {displayName}
                      </span>
                      {competition.countryCode ? (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {competition.countryCode}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Badge variant={variant} className="self-start">
                    {label}
                  </Badge>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <div className="mt-8">
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          buildHref={(targetPage) => buildHref({ page: targetPage, search, countryCode })}
        />
      </div>
    </Container>
  );
}
