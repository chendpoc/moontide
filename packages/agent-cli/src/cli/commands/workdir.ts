import { getWorkdir, setWorkdir } from "@moontide/agent";
import { renderStatusLine } from "../statusline/render.js";
import { reply } from "./io.js";
import type { ParsedReplCommand, ReplCommandResult } from "./types.js";

export function handleWorkdirCommand(parsed: ParsedReplCommand): ReplCommandResult {
  if (!parsed.parts[1]) {
    reply(`workdir: ${getWorkdir()}`);
    return "handled";
  }
  setWorkdir(parsed.parts.slice(1).join(" "));
  reply(`workdir: ${getWorkdir()}`);
  renderStatusLine();
  return "handled";
}
