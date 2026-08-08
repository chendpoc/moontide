import { resetRuntimeStatus } from "../../agent/context-status.js";
import { resetDebugOverride } from "../../context-inspect/debug-mode.js";
import { autoSaveSession } from "../../plugins/builtin/session-persistence/index.js";
import { resetRun } from "../../log/index.js";
import { resetAlwaysAllowOverride } from "../../tools/always-allow-mode.js";
import { resetDeepModeOnNewSession } from "../../agent/deep-mode.js";
import { getAgentRuntime } from "../../agent/runtime/index.js";
import { createReplSessionPersistenceDeps } from "../session-persistence-glue.js";
import { renderStatusLine } from "../statusline/render.js";
import { resetReplSession } from "../repl/session.js";
import { reply } from "./io.js";
import type { ReplCommandContext, ReplCommandResult } from "./types.js";

export function resetReplConversation(): void {
  autoSaveSession(createReplSessionPersistenceDeps());
  resetReplSession();
  resetRuntimeStatus();
  resetDebugOverride();
  resetAlwaysAllowOverride();
  resetDeepModeOnNewSession();
  getAgentRuntime().tools.refresh();
  resetRun();
}

export function handleResetCommand(ctx: ReplCommandContext): ReplCommandResult {
  ctx.resetConversation();
  reply("session reset");
  renderStatusLine();
  return "handled";
}
