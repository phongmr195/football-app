import type { MatchOddsResponse } from "@/lib/types";

export interface MatchOddsProps {
  odds: MatchOddsResponse;
}

// Sofascore's raw shape thật (mỗi row DB = 1 market, xem packages/database/prisma/schema.prisma's
// MatchOdds — "raw" giữ nguyên cả object market, KHÔNG tách field). Verify thật 2026-08-22 qua
// probe trực tiếp /event/{id}/odds/1/all cho 1 trận SCHEDULED thật (Hull City vs Man United).
interface SofascoreOddsChoice {
  name?: unknown;
  fractionalValue?: unknown;
}
interface SofascoreOddsMarket {
  marketName?: unknown;
  marketGroup?: unknown;
  marketPeriod?: unknown;
  choices?: unknown;
}

const CHOICE_LABELS: Record<string, string> = { "1": "Chủ nhà", X: "Hòa", "2": "Khách" };

// "17/2" (Sofascore fractional/UK-style) -> decimal "9.50" (decimal = numerator/denominator + 1)
// — dễ đọc hơn fractional với đa số người dùng ngoài UK. Fallback về chuỗi gốc nếu parse thất bại
// (định dạng lạ chưa gặp) thay vì hiện NaN.
function toDecimalOdds(fractionalValue: unknown): string {
  if (typeof fractionalValue !== "string") return "—";
  const [numeratorStr, denominatorStr] = fractionalValue.split("/");
  const numerator = Number(numeratorStr);
  const denominator = Number(denominatorStr);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return fractionalValue;
  }
  return (numerator / denominator + 1).toFixed(2);
}

function parseChoices(raw: SofascoreOddsMarket): { name: string; decimal: string }[] {
  const choices = Array.isArray(raw.choices) ? (raw.choices as SofascoreOddsChoice[]) : [];
  return choices
    .filter((c): c is { name: string; fractionalValue: unknown } => typeof c.name === "string")
    .map((c) => ({ name: c.name, decimal: toDecimalOdds(c.fractionalValue) }));
}

/**
 * Server Component — render generic theo raw market object Sofascore trả (không hardcode theo
 * loại market cụ thể, trừ market chính "Full time"/1X2 được ưu tiên hiện nổi bật). CHỈ nên được
 * render khi match đang SCHEDULED/LIVE (odds hết ý nghĩa khi FINISHED) — quyết định đó thuộc về
 * page.tsx gọi component này (xem matches/[id]/page.tsx), component không tự kiểm tra status.
 */
export function MatchOdds({ odds }: MatchOddsProps) {
  const markets = odds.items.map((item) => ({ ...item, raw: (item.raw ?? {}) as SofascoreOddsMarket }));

  if (markets.length === 0) {
    return <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">Chưa có tỉ lệ cược.</p>;
  }

  const primaryIndex = markets.findIndex((m) => m.raw.marketGroup === "1X2" && m.raw.marketPeriod === "Full-time");
  const primary = primaryIndex >= 0 ? markets[primaryIndex] : null;
  const secondary = markets.filter((_, i) => i !== primaryIndex);

  return (
    <div className="flex flex-col gap-6">
      {primary ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Kết quả trận (FT)</h3>
          <div className="grid grid-cols-3 gap-3">
            {parseChoices(primary.raw).map((choice) => (
              <div
                key={choice.name}
                className="flex flex-col items-center gap-1 rounded-lg border border-zinc-200 py-3 dark:border-zinc-800"
              >
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {CHOICE_LABELS[choice.name] ?? choice.name}
                </span>
                <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{choice.decimal}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {secondary.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Các loại tỉ lệ khác</h3>
          {secondary.map((market) => {
            const choices = parseChoices(market.raw);
            if (choices.length === 0) return null;
            return (
              <div
                key={market.sofascoreMarketId}
                className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-700 dark:text-zinc-300"
              >
                <span>{typeof market.raw.marketName === "string" ? market.raw.marketName : market.marketName}</span>
                <span className="flex flex-wrap gap-3 text-zinc-500 dark:text-zinc-400">
                  {choices.map((choice) => (
                    <span key={choice.name}>
                      {CHOICE_LABELS[choice.name] ?? choice.name}: {choice.decimal}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
