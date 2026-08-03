import { handleCompactCommand } from "./compact.js";
import { handleHelpCommand } from "./help.js";
import { handleThinkingCommand, handleVerboseCommand } from "./observability.js";
import { handleResetCommand } from "./reset.js";
import { handleStatusCommand } from "./status.js";
import { parseReplCommand, type ReplCommandContext, type ReplCommandResult } from "./types.js";
import { handleWorkdirCommand } from "./workdir.js";

export type { ReplCommandContext, ReplCommandResult } from "./types.js";
export { resetReplConversation } from "./reset.js";

export async function handleReplCommand(
  trimmed: string,
  ctx: ReplCommandContext,
): Promise<ReplCommandResult> {
  const parsed = parseReplCommand(trimmed);
  if (!parsed) {
    return "not_command";
  }

  switch (parsed.cmd) {
    case "/help":
      return handleHelpCommand();
    case "/reset":
    case "/new":
      return handleResetCommand(ctx);
    case "/status":
      return await handleStatusCommand(ctx);
    case "/workdir":
      return handleWorkdirCommand(parsed);
    case "/compact":
      return handleCompactCommand(parsed, ctx);
    case "/thinking":
      return handleThinkingCommand(parsed.arg);
    case "/verbose":
      return handleVerboseCommand(parsed.arg);
    default:
      return "unknown";
  }
}
