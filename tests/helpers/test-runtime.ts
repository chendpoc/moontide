import {
  createAgentRuntime,
  setAgentRuntime,
  type AgentRuntime,
} from "../../src/agent/runtime/index.js";
import { getWorkdir } from "../../src/config.js";

let active: AgentRuntime | undefined;

import type { UserInteraction, ToolContext } from "../../src/tools/types.js";
import { getWorkdir } from "../../src/config.js";

const denyAllInteraction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

/** Install an isolated AgentRuntime for tests (hooks + default tools). */
export function installTestRuntime(workdir = getWorkdir()): AgentRuntime {
  const runtime = createAgentRuntime();
  setAgentRuntime(runtime);
  runtime.registerDefaultSidecarHooks(workdir);
  active = runtime;
  return runtime;
}

export function getTestRuntime(): AgentRuntime {
  return active ?? installTestRuntime();
}

export function clearTestRuntime(): void {
  active?.reset();
  setAgentRuntime(undefined);
  active = undefined;
}

export function testToolContext(
  workdir: string,
  userInteraction: UserInteraction = denyAllInteraction,
): ToolContext {
  return {
    workdir,
    userInteraction,
    runtime: getTestRuntime(),
  };
}
