import { formatStatusLineLegend } from "../statusline/format.js";
import { reply } from "./io.js";
import type { ReplCommandResult } from "./types.js";

export function handleHelpCommand(): ReplCommandResult {
  reply("REPL commands:");
  reply("  /help · /reset · /status · /workdir [path]");
  reply("  /thinking on|off · /verbose on|off  (call chain & debug trace)");
  reply("  /compact [preview|summary] · /compact auto on|off");
  reply("  q · exit");
  reply(formatStatusLineLegend());
  return "handled";
}
