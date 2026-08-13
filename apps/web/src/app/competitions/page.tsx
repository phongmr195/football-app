import Image from "next/image";
import Link from "next/link";
import { Badge, Card, Container } from "@football-app/ui";
import { apiGet, type ApiListResponse } from "@/lib/api-client";
import { competitionTypeMeta } from "@/lib/format";
import type { Competition } from "@/lib/types";

// Competition catalog rarely changes — long ISR window is fine.
export const revalidate = 3600;

async function getCompetitions(page: number) {
  return apiGet<ApiListResponse<Competition>>("/competitions", { page });
}

export default async function CompetitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const { items, pageSize, total } = await getCompetitions(page);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Container size="lg" className="py-10">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Giải đấu
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {total.toLocaleString("vi-VN")} giải đấu &middot; Trang {page}/{totalPages}
        </p>
      </div>

      {items.length === 0 ? (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          Không có giải đấu nào.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((competition) => {
            const { label, variant } = competitionTypeMeta(competition.type);
            return (
              <Link key={competition.id} href={`/competitions/${competition.id}`}>
                <Card className="flex h-full flex-col gap-3 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                  <div className="flex items-center gap-3">
                    {competition.logoUrl ? (
                      <Image
                        src={competition.logoUrl}
                        alt={competition.name}
                        width={40}
                        height={40}
                        className="h-10 w-10 object-contain"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-zinc-100 dark:bg-zinc-800" />
                    )}
                    <div className="flex flex-col">
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        {competition.name}
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

      <nav className="mt-8 flex items-center justify-center gap-4 text-sm">
        {page > 1 ? (
          <Link
            href={`/competitions?page=${page - 1}`}
            className="text-zinc-700 hover:underline dark:text-zinc-300"
          >
            &larr; Trang trước
          </Link>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-600">&larr; Trang trước</span>
        )}
        <span className="text-zinc-500 dark:text-zinc-400">
          {page} / {totalPages}
        </span>
        {page < totalPages ? (
          <Link
            href={`/competitions?page=${page + 1}`}
            className="text-zinc-700 hover:underline dark:text-zinc-300"
          >
            Trang sau &rarr;
          </Link>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-600">Trang sau &rarr;</span>
        )}
      </nav>
    </Container>
  );
}
