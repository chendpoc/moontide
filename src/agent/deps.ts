import { internalError } from "../errors/factories.js";
import { getWorkdir } from "../config.js";
import type { SessionStores } from "../session/stores/index.js";
import type { ToolContext, UserInteraction } from "../tools/types.js";
import type { Session } from "../session/session.js";
import type { AgentRuntime } from "./runtime/index.js";

export interface LoopContext {
  userInteraction: UserInteraction;
  session: Session;
  stores?: SessionStores;
  runtime: AgentRuntime;
}

const denyAllInteraction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw internalError("User question prompt is not configured");
  },
};

export function createDefaultLoopContext(session: Session, runtime: AgentRuntime): LoopContext {
  return {
    userInteraction: denyAllInteraction,
    session,
    runtime,
  };
}

export function createDefaultToolContext(runtime: AgentRuntime): ToolContext {
  return {
    workdir: getWorkdir(),
    userInteraction: denyAllInteraction,
    runtime: { tools: runtime.tools },
  };
}

export function createToolContext(loopCtx: LoopContext): ToolContext {
  return {
    workdir: getWorkdir(),
    userInteraction: loopCtx.userInteraction,
    sessionId: loopCtx.session.sessionId,
    runtime: { tools: loopCtx.runtime.tools },
  };
}
