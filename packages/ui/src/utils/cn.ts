type ClassValue = string | number | boolean | null | undefined;

/**
 * Minimal className joiner (filters out falsy values). No dependency on
 * clsx/tailwind-merge — this package intentionally stays dependency-free
 * for such a small primitive set; revisit if variant/className conflicts
 * become common enough to need real conflict resolution.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter((value) => typeof value === "string" && value.length > 0).join(" ");
}
