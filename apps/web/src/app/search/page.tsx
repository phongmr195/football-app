import Image from "next/image";
import Link from "next/link";
import { Badge, Card, Container } from "@football-app/ui";
import { SearchBox } from "@/components/SearchBox";
import { apiGet } from "@/lib/api-client";
import { competitionDisplayName, competitionTypeMeta, playerPositionMeta } from "@/lib/format";
import type { SearchResults } from "@/lib/types";

/**
 * Not ISR/cached (no `revalidate` export) — search results are query-dependent (one page per
 * `q`, effectively infinite variations) and cheap enough to compute per-request (GET /search
 * caps each entity type at 5 rows, see apps/api/src/routes/search.ts).
 */
async function getResults(q: string): Promise<SearchResults> {
  return apiGet<SearchResults>("/search", { q });
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const results = query ? await getResults(query) : null;
  const totalResults = results
    ? results.teams.length + results.players.length + results.competitions.length
    : 0;

  return (
    <Container size="md" className="py-10">
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Tìm kiếm</h1>

      <SearchBox
        className="mb-8"
        defaultValue={query}
        placeholder="Tìm đội bóng, cầu thủ, giải đấu..."
        autoFocus
      />

      {!query ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Nhập từ khoá để tìm đội bóng, cầu thủ hoặc giải đấu.
        </p>
      ) : totalResults === 0 ? (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          Không tìm thấy kết quả nào cho &quot;{query}&quot;.
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {results!.competitions.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                Giải đấu
              </h2>
              <ul className="flex flex-col gap-2">
                {results!.competitions.map((competition) => {
                  const { label, variant } = competitionTypeMeta(competition.type);
                  const displayName = competitionDisplayName(competition);
                  return (
                    <li key={competition.id}>
                      <Link href={`/competitions/${competition.id}`}>
                        <Card
                          padding="sm"
                          className="flex items-center justify-between gap-4 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
                        >
                          <div className="flex items-center gap-3">
                            {competition.logoUrl ? (
                              <Image
                                src={competition.logoUrl}
                                alt={displayName}
                                width={32}
                                height={32}
                                className="h-8 w-8 object-contain"
                              />
                            ) : (
                              <div className="h-8 w-8 rounded bg-zinc-100 dark:bg-zinc-800" />
                            )}
                            <span className="font-medium text-zinc-900 dark:text-zinc-50">
                              {displayName}
                            </span>
                          </div>
                          <Badge variant={variant}>{label}</Badge>
                        </Card>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {results!.teams.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                Đội bóng
              </h2>
              <ul className="flex flex-col gap-2">
                {results!.teams.map((team) => (
                  <li key={team.id}>
                    <Link href={`/teams/${team.id}`}>
                      <Card
                        padding="sm"
                        className="flex items-center gap-3 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
                      >
                        {team.logoUrl ? (
                          <Image
                            src={team.logoUrl}
                            alt={team.name}
                            width={32}
                            height={32}
                            className="h-8 w-8 object-contain"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded bg-zinc-100 dark:bg-zinc-800" />
                        )}
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          {team.name}
                        </span>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results!.players.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                Cầu thủ
              </h2>
              <ul className="flex flex-col gap-2">
                {results!.players.map((player) => {
                  const { label, variant } = playerPositionMeta(player.position);
                  return (
                    <li key={player.id}>
                      <Link href={`/players/${player.id}`}>
                        <Card
                          padding="sm"
                          className="flex items-center justify-between gap-4 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
                        >
                          <div className="flex flex-col">
                            <span className="font-medium text-zinc-900 dark:text-zinc-50">
                              {player.name}
                            </span>
                            {player.team ? (
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                {player.team.name}
                              </span>
                            ) : null}
                          </div>
                          <Badge variant={variant}>{label}</Badge>
                        </Card>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </Container>
  );
}
