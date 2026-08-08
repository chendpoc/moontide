import {
  createAgentRuntime,
  setAgentRuntime,
  type AgentRuntime,
} from "../../apps/moontide/src/agent/runtime/index.js";
import { getWorkdir } from "../../apps/moontide/src/config.js";
import { registerBuiltinWorkMemPorts } from "../../apps/moontide/src/plugins/builtin/work-mem/register.js";
import { resetAlwaysAllowOverride } from "../../apps/moontide/src/tools/always-allow-mode.js";

let active: AgentRuntime | undefined;

import type { UserInteraction, ToolContext } from "@moontide/tools";
import { getWorkdir } from "../../apps/moontide/src/config.js";

const denyAllInteraction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

/** Install an isolated AgentRuntime for tests (hooks + default tools). */
export function installTestRuntime(workdir = getWorkdir()): AgentRuntime {
  registerBuiltinWorkMemPorts();
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
