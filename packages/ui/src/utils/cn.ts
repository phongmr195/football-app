// Some @base-ui/react primitives (Avatar, Separator — used by shadcn's "base-nova" style, see
// apps/web/components.json) type their `className` prop as `string | ((state) => string |
// undefined)`, a render-prop form for state-dependent styling. The generated shadcn components
// forward that prop straight into `cn(...)` — this app never actually passes a function (every
// real call site here uses plain strings), but the PARAMETER TYPE still has to accept it or
// those files fail to typecheck. The `(state: never) => ...` union member exists purely to
// satisfy that structural type match; the runtime filter below still only keeps strings, so a
// function value (if one were ever passed) is silently dropped, not called.
type ClassValue = string | number | boolean | null | undefined | ((state: never) => string | undefined);

/**
 * Minimal className joiner (filters out falsy values). No dependency on
 * clsx/tailwind-merge — this package intentionally stays dependency-free
 * for such a small primitive set; revisit if variant/className conflicts
 * become common enough to need real conflict resolution.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter((value) => typeof value === "string" && value.length > 0).join(" ");
}
