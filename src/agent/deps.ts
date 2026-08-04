import { getWorkdir } from "../config.js";
import type { SessionStores } from "../context/stores/index.js";
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
    throw new Error("User question prompt is not configured");
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
    runtime,
  };
}

export function createToolContext(loopCtx: LoopContext): ToolContext {
  return {
    workdir: getWorkdir(),
    userInteraction: loopCtx.userInteraction,
    runtime: loopCtx.runtime,
  };
}
