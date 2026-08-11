import {
  createAgentRuntime,
  getWorkdir,
  setAgentRuntime,
  setupAgentEventPipeline,
  type AgentEventPipeline,
  type AgentRuntime,
} from "@moontide/agent";
import { createTestEventPipeline } from "@moontide/agent/testing";
import { registerBuiltinWorkMemPorts } from "../../packages/agent/src/plugins/builtin/work-mem/register.js";
import { resetAlwaysAllowOverride } from "../../packages/agent/src/tools/always-allow-mode.js";

let active: AgentRuntime | undefined;

import type { UserInteraction, ToolContext } from "@moontide/tools";

const denyAllInteraction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

/** Install an isolated AgentRuntime for tests (hooks + default tools + event pipeline). */
export function installTestRuntime(
  workdir = getWorkdir(),
  pipeline: AgentEventPipeline = createTestEventPipeline(),
): AgentRuntime {
  registerBuiltinWorkMemPorts();
  const runtime = createAgentRuntime();
  setAgentRuntime(runtime);
  setupAgentEventPipeline(runtime, pipeline, workdir);
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
  resetAlwaysAllowOverride();
  delete process.env.MOONTIDE_ALWAYS_ALLOW;
}

export function testToolContext(
  workdir: string,
  userInteraction: UserInteraction = denyAllInteraction,
): ToolContext {
  return {
    workdir,
    userInteraction,
    runtime: { tools: getTestRuntime().tools },
  };
}
