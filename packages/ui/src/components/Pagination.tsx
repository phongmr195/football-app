import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "../utils/cn";

export interface PaginationProps {
  /** 1-indexed current page. */
  currentPage: number;
  /** Total number of pages (must be >= 1). */
  totalPages: number;
  /**
   * Builds the href for a given page number. Callers control how other query params
   * (search terms, filters, etc.) are preserved/merged alongside `page` — mirrors the
   * `buildHref` pattern already used for status-filter links in apps/web's matches page.
   */
  buildHref: (page: number) => string;
  className?: string;
}

/** Max number of page-number buttons shown in the sliding window. */
const WINDOW_SIZE = 6;

function getPageWindow(currentPage: number, totalPages: number): { start: number; end: number } {
  if (totalPages <= WINDOW_SIZE) {
    return { start: 1, end: totalPages };
  }
  const maxStart = totalPages - WINDOW_SIZE + 1;
  // Center the window on currentPage (2 pages of lookbehind), clamped so it never runs
  // past page 1 or past the last possible window start.
  const start = Math.min(Math.max(currentPage - 2, 1), maxStart);
  return { start, end: start + WINDOW_SIZE - 1 };
}

const pillBase =
  "inline-flex h-10 min-w-10 items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors";

function Pill({
  href,
  disabled,
  active,
  ariaLabel,
  children,
}: {
  href: string;
  disabled?: boolean;
  active?: boolean;
  ariaLabel?: string;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={cn(
          pillBase,
          "cursor-not-allowed border-orange-100 bg-white text-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-700"
        )}
      >
        {children}
      </span>
    );
  }
  if (active) {
    return (
      <span
        aria-current="page"
        className={cn(pillBase, "border-orange-500 bg-orange-500 font-bold text-white")}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={cn(
        pillBase,
        "border-orange-100 bg-white text-zinc-700 hover:border-orange-300 hover:bg-orange-50",
        "dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700"
      )}
    >
      {children}
    </Link>
  );
}

const ellipsis = (
  <span className="inline-flex h-10 min-w-10 items-center justify-center text-sm text-zinc-400 dark:text-zinc-600">
    &hellip;
  </span>
);

/**
 * Shared pagination control: prev/next pills + a sliding window of page-number pills,
 * with jump-to-first/jump-to-last pills + ellipses when the window doesn't reach the
 * edges. Built around `Link`+`href` (works fine in Server Components, no client state
 * needed) so it composes with pages that drive pagination purely via `?page=`.
 */
export function Pagination({ currentPage, totalPages, buildHref, className }: PaginationProps) {
  const { start, end } = getPageWindow(currentPage, totalPages);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <nav
      aria-label="Phân trang"
      className={cn("flex flex-wrap items-center justify-center gap-2", className)}
    >
      <Pill href={buildHref(currentPage - 1)} disabled={currentPage <= 1} ariaLabel="Trang trước">
        &laquo; Trang trước
      </Pill>

      {start > 1 ? (
        <>
          <Pill href={buildHref(1)} ariaLabel="Về trang đầu">
            &laquo;&laquo;
          </Pill>
          {ellipsis}
        </>
      ) : null}

      {pages.map((page) => (
        <Pill key={page} href={buildHref(page)} active={page === currentPage}>
          {page}
        </Pill>
      ))}

      {end < totalPages ? (
        <>
          {ellipsis}
          <Pill href={buildHref(totalPages)} ariaLabel="Đến trang cuối">
            &raquo;&raquo;
          </Pill>
        </>
      ) : null}

      <Pill
        href={buildHref(currentPage + 1)}
        disabled={currentPage >= totalPages}
        ariaLabel="Trang sau"
      >
        Trang sau &raquo;
      </Pill>
    </nav>
  );
}
