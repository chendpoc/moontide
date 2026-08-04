import { parseReplCommand, type ReplCommandContext, type ReplCommandResult } from "./types.js";
import { resolveReplCommand } from "./registry.js";

export type { ReplCommandContext, ReplCommandResult } from "./types.js";
export { resetReplConversation } from "./reset.js";
export { REPL_COMMANDS, replCommandHelpLines, resolveReplCommand } from "./registry.js";

export async function handleReplCommand(
  trimmed: string,
  ctx: ReplCommandContext,
): Promise<ReplCommandResult> {
  const parsed = parseReplCommand(trimmed);
  if (!parsed) {
    return "not_command";
  }

  const spec = resolveReplCommand(parsed.cmd);
  if (!spec) {
    return "unknown";
  }

  return spec.handler(parsed, ctx);
}
