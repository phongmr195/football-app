"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@football-app/ui";
import { apiGetClient, type ApiListResponse } from "@/lib/api-client";
import { Input } from "./ui/input";
import type { SearchPlayerItem } from "@/lib/types";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

export interface PlayerPickerProps {
  label: string;
  selected: SearchPlayerItem | null;
  onSelect: (player: SearchPlayerItem) => void;
  onClear: () => void;
  /** Loại khỏi kết quả gợi ý — tránh chọn cùng 1 cầu thủ ở cả 2 ô. */
  excludeId?: string;
  className?: string;
}

/**
 * Picker nhỏ cho trang /compare — KHÁC SearchBox (search chung 3 loại, click thì navigate
 * thẳng): chỉ search players qua GET /players?search= (đã có sẵn, apps/api/src/routes/
 * players.ts), chọn thì gọi onSelect() để lưu vào state local của trang, không điều hướng đi
 * đâu. Debounce/click-outside cùng pattern SearchBox.tsx.
 */
export function PlayerPicker({ label, selected, onSelect, onClear, excludeId, className }: PlayerPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchPlayerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      apiGetClient<ApiListResponse<SearchPlayerItem>>("/players", { search: trimmed, pageSize: 8 })
        .then((data) => {
          if (cancelled) return;
          setResults(data.items);
          setOpen(true);
        })
        .catch((err) => {
          console.error("PlayerPicker: search thất bại", err);
          if (!cancelled) setResults([]);
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
  const filteredResults = results.filter((p) => p.id !== excludeId);
  const showDropdown = open && trimmedQuery.length >= MIN_QUERY_LENGTH;

  if (selected) {
    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <div className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          {selected.team?.logoUrl ? (
            <Image
              src={selected.team.logoUrl}
              alt={selected.team.name}
              width={28}
              height={28}
              className="h-7 w-7 object-contain"
            />
          ) : (
            <div className="h-7 w-7 rounded bg-zinc-100 dark:bg-zinc-800" />
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">{selected.name}</span>
            {selected.team ? (
              <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{selected.team.name}</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label={`Bỏ chọn ${selected.name}`}
            className="shrink-0 rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative flex flex-col gap-1.5", className)}>
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <Input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder="Tìm cầu thủ..."
        autoComplete="off"
      />

      {showDropdown ? (
        <div className="absolute top-full z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {loading ? (
            <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">Đang tìm...</p>
          ) : filteredResults.length === 0 ? (
            <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">Không tìm thấy cầu thủ nào.</p>
          ) : (
            filteredResults.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => {
                  onSelect(player);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
                {player.team ? (
                  <span className="ml-auto shrink-0 truncate text-xs text-zinc-400 dark:text-zinc-600">
                    {player.team.name}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
