"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@football-app/ui";
import { apiGetClient } from "@/lib/api-client";
import { competitionDisplayName, playerPositionMeta } from "@/lib/format";
import type { SearchResults } from "@/lib/types";
import { Input } from "./ui/input";

// 1 ký tự thường ra quá nhiều kết quả nhiễu (vd "a" match hầu hết đội bóng) — chờ ít nhất 2 ký
// tự mới gọi API, giống ngưỡng phổ biến của autocomplete search box.
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

export interface SearchBoxProps {
  className?: string;
  placeholder?: string;
  defaultValue?: string;
  autoFocus?: boolean;
}

/**
 * Ô tìm kiếm có dropdown gợi ý trực tiếp khi gõ (teams/players/competitions), dùng chung cho cả
 * NavBar (thu gọn) lẫn /search page (thay cho input tĩnh cũ) — bấm vào 1 gợi ý điều hướng thẳng
 * tới trang chi tiết, không cần qua trang kết quả trước. Vẫn giữ `<form method="GET">` bọc ngoài
 * nên Enter (không qua dropdown, vd màn hình nhỏ/screen reader) vẫn điều hướng tới /search?q=...
 * đầy đủ như trước — dropdown là tăng cường (progressive enhancement), không phải cách duy nhất.
 */
export function SearchBox({ className, placeholder, defaultValue, autoFocus }: SearchBoxProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(defaultValue ?? "");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    // Không setState ở đây khi query quá ngắn — showDropdown (tính lúc render, xem bên dưới) đã
    // tự ẩn dropdown dựa trên độ dài query hiện tại, không cần "dọn" results/loading qua effect
    // (đúng pattern "adjust state during render" thay vì setState đồng bộ trong effect, cùng lý
    // do CompetitionFilters.tsx tránh react-hooks/set-state-in-effect).
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      apiGetClient<SearchResults>("/search", { q: trimmed })
        .then((data) => {
          if (cancelled) return;
          setResults(data);
          setOpen(true);
        })
        .catch((err) => {
          console.error("SearchBox: search thất bại", err);
          if (!cancelled) setResults(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const trimmedQuery = query.trim();
  const hasResults = results
    ? results.teams.length + results.players.length + results.competitions.length > 0
    : false;
  const showDropdown = open && trimmedQuery.length >= MIN_QUERY_LENGTH;

  function closeDropdown() {
    setOpen(false);
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <form action="/search" method="GET" onSubmit={closeDropdown} className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="text"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (results) setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeDropdown();
          }}
          placeholder={placeholder ?? "Tìm kiếm..."}
          autoComplete="off"
          autoFocus={autoFocus}
          className="pl-8"
        />
      </form>

      {showDropdown ? (
        <div className="absolute z-50 mt-1 max-h-96 w-full min-w-[280px] overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {loading && !results ? (
            <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">Đang tìm...</p>
          ) : !hasResults ? (
            <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
              Không tìm thấy kết quả nào.
            </p>
          ) : (
            <>
              {results!.competitions.map((competition) => (
                <Link
                  key={competition.id}
                  href={`/competitions/${competition.id}`}
                  onClick={closeDropdown}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {competition.logoUrl ? (
                    <Image
                      src={competition.logoUrl}
                      alt={competitionDisplayName(competition)}
                      width={20}
                      height={20}
                      className="h-5 w-5 shrink-0 object-contain"
                    />
                  ) : (
                    <div className="h-5 w-5 shrink-0 rounded bg-zinc-100 dark:bg-zinc-800" />
                  )}
                  <span className="truncate text-zinc-900 dark:text-zinc-50">
                    {competitionDisplayName(competition)}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-zinc-400 dark:text-zinc-600">
                    Giải đấu
                  </span>
                </Link>
              ))}
              {results!.teams.map((team) => (
                <Link
                  key={team.id}
                  href={`/teams/${team.id}`}
                  onClick={closeDropdown}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {team.logoUrl ? (
                    <Image
                      src={team.logoUrl}
                      alt={team.name}
                      width={20}
                      height={20}
                      className="h-5 w-5 shrink-0 object-contain"
                    />
                  ) : (
                    <div className="h-5 w-5 shrink-0 rounded bg-zinc-100 dark:bg-zinc-800" />
                  )}
                  <span className="truncate text-zinc-900 dark:text-zinc-50">{team.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-zinc-400 dark:text-zinc-600">
                    Đội bóng
                  </span>
                </Link>
              ))}
              {results!.players.map((player) => {
                const { label } = playerPositionMeta(player.position);
                return (
                  <Link
                    key={player.id}
                    href={`/players/${player.id}`}
                    onClick={closeDropdown}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {player.team?.logoUrl ? (
                      <Image
                        src={player.team.logoUrl}
                        alt={player.team.name}
                        width={20}
                        height={20}
                        className="h-5 w-5 shrink-0 object-contain"
                      />
                    ) : (
                      <div className="h-5 w-5 shrink-0 rounded bg-zinc-100 dark:bg-zinc-800" />
                    )}
                    <span className="truncate text-zinc-900 dark:text-zinc-50">{player.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-zinc-400 dark:text-zinc-600">
                      {label}
                    </span>
                  </Link>
                );
              })}
              <Link
                href={`/search?q=${encodeURIComponent(trimmedQuery)}`}
                onClick={closeDropdown}
                className="block border-t border-zinc-100 px-3 py-2 text-center text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                Xem tất cả kết quả cho &quot;{trimmedQuery}&quot;
              </Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
