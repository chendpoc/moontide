import { resetRuntimeStatus } from "../../context/runtime-status.js";
import { resetRun } from "../../log/run.js";
import { renderStatusLine } from "../statusline/render.js";
import { resetReplSession } from "../repl/session.js";
import { reply } from "./io.js";
import type { ReplCommandContext, ReplCommandResult } from "./types.js";

export function resetReplConversation(): void {
  resetReplSession();
  resetRuntimeStatus();
  resetRun();
}

export function handleResetCommand(ctx: ReplCommandContext): ReplCommandResult {
  ctx.resetConversation();
  reply("session reset");
  renderStatusLine();
  return "handled";
}
