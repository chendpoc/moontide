import {
  createAgentRuntime,
  getWorkdir,
  setAgentRuntime,
  setupAgentEventOutputs,
  type AgentEventOutputs,
  type AgentRuntime,
} from "@moontide/agent";
import { createTestEventOutputs } from "@moontide/agent/testing";
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

/** Install an isolated AgentRuntime for tests (hooks + default tools + event outputs). */
export function installTestRuntime(
  workdir = getWorkdir(),
  eventOutputs: AgentEventOutputs = createTestEventOutputs(),
): AgentRuntime {
  registerBuiltinWorkMemPorts();
  const runtime = createAgentRuntime();
  setAgentRuntime(runtime);
  setupAgentEventOutputs(runtime, eventOutputs, workdir);
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
