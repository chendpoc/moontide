export function truncateOneLine(text: string, max = 40, ellipsis = "…"): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  const sliceEnd = Math.max(0, max - ellipsis.length);
  return `${oneLine.slice(0, sliceEnd)}${ellipsis}`;
}

export function truncateChars(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, limit), truncated: true };
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- intentional ANSI escape stripping
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}
