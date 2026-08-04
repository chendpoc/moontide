export function fmt(value: number): string {
  return value.toLocaleString("en-US");
}

export function padTurn(turn: number): string {
  return String(turn).padStart(2, "0");
}

export function boxLine(content: string, width: number): string {
  const inner = content.slice(0, width);
  return `│ ${inner.padEnd(width)} │`;
}

const TURN_BANNER_WIDTH = 36;

export function formatTurnBanner(turn: number): string {
  const label = ` turn ${padTurn(turn)} `;
  const dashes = Math.max(2, TURN_BANNER_WIDTH - label.length);
  return `──${label}${"─".repeat(dashes)}`;
}

export function formatChannelSeparator(from: string, to: string): string {
  return `· ${from} → ${to} `;
}
