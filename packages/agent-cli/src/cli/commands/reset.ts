import {
  autoSaveSession,
  getAgentRuntime,
  resetAlwaysAllowOverride,
  resetDebugOverride,
  resetDeepModeOnNewSession,
  resetRuntimeStatus,
} from "@moontide/agent";
import { resetRun } from "../../log/index.js";
import { createReplSessionLifecycleAccess } from "../session-persistence-glue.js";
import { renderStatusLine } from "../statusline/render.js";
import { resetReplSession } from "../repl/session.js";
import { reply } from "./io.js";
import type { ReplCommandContext, ReplCommandResult } from "./types.js";

export function resetReplConversation(): void {
  autoSaveSession(createReplSessionLifecycleAccess());
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
