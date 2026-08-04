import { formatStatusLineLegend } from "../statusline/format.js";
import { replCommandHelpLines } from "./registry.js";
import { reply } from "./io.js";
import type { ReplCommandResult } from "./types.js";

export function handleHelpCommand(): ReplCommandResult {
  reply("REPL commands:");
  reply(`  ${replCommandHelpLines().join(" · ")}`);
  reply("  q · exit");
  reply(formatStatusLineLegend());
  return "handled";
}
