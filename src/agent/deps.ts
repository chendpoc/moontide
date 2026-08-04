import { getWorkdir } from "../config.js";
import type { SessionStores } from "../context/stores/index.js";
import type { ToolContext, UserInteraction } from "../tools/types.js";
import type { Session } from "../session/session.js";

export interface LoopContext {
  userInteraction: UserInteraction;
  session: Session;
  stores?: SessionStores;
}

const denyAllInteraction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

export function createDefaultLoopContext(session: Session): LoopContext {
  return {
    userInteraction: denyAllInteraction,
    session,
  };
}

export function createDefaultToolContext(): ToolContext {
  return {
    workdir: getWorkdir(),
    userInteraction: denyAllInteraction,
  };
}

export function createToolContext(loopCtx: LoopContext): ToolContext {
  return {
    workdir: getWorkdir(),
    userInteraction: loopCtx.userInteraction,
  };
}
