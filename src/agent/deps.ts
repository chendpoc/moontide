import { compactAutoDefault, getWorkdir } from "../config.js";
import type { ToolContext, UserInteraction } from "../toolkit/types.js";

export interface LoopContext {
  userInteraction: UserInteraction;
  isCompactAutoEnabled: () => boolean;
}

const denyAllInteraction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

export function createDefaultLoopContext(): LoopContext {
  return {
    userInteraction: denyAllInteraction,
    isCompactAutoEnabled: () => compactAutoDefault(),
  };
}

export function createToolContext(loopCtx: LoopContext): ToolContext {
  return {
    workdir: getWorkdir(),
    userInteraction: loopCtx.userInteraction,
  };
}
