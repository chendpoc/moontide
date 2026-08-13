import { cliTheme, turnSeparator } from "../../terminal/theme.js";

/** Formatting helpers for Transcript lines (IO delegated to ReplTerminal). */
export function formatUserLine(text: string): string {
  return `${cliTheme.dim("›")} ${text}`;
}

export function formatTurnSeparatorLine(): string {
  return turnSeparator();
}
