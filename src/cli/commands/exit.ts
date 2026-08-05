import type { ReplCommandResult } from "./types.js";

export function handleExitCommand(): ReplCommandResult {
  return "exit";
}
