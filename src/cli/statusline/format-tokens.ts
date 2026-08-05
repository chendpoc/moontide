import type { StatusSnapshot } from "./types.js";

function trimTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}

/** Compact token count: 2197 → 2.2k, 128000 → 128k */
export function formatCompactTokens(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${trimTrailingZero((value / 1_000_000).toFixed(1))}M`;
  }
  if (abs >= 1000) {
    return `${trimTrailingZero((value / 1000).toFixed(1))}k`;
  }
  return String(value);
}

export function formatContextSegment(snapshot: StatusSnapshot): string | null {
  if (snapshot.contextUsed === null || snapshot.contextLimit === null) {
    return null;
  }
  const used = formatCompactTokens(snapshot.contextUsed);
  const limit = formatCompactTokens(snapshot.contextLimit);
  const pct =
    snapshot.contextPct !== null ? `(${snapshot.contextPct.toFixed(1)}%)` : "";
  return `${used}/${limit}${pct}`;
}
