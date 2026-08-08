import chalk from "chalk";

const theme = {
  border: chalk.cyan.dim,
  title: chalk.cyan.bold,
  kind: chalk.white.bold,
};

export interface DebugRecordBase {
  kind: string;
  turn: number;
}

export function formatDebugRecord(record: DebugRecordBase & Record<string, unknown>): string {
  const header = `${theme.title(`DEBUG turn ${String(record.turn).padStart(2, "0")}`)}  ${theme.kind(record.kind)}`;
  const body = JSON.stringify(record, null, 2);
  const width = Math.min(72, Math.max(header.length + 4, 48));
  const top = theme.border(`┌─ ${header} ${"─".repeat(Math.max(2, width - header.length - 4))}`);
  const bottom = theme.border(`└${"─".repeat(width + 2)}┘`);
  return [top, body, bottom].join("\n");
}
