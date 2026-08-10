import {
  createAgentRuntime,
  setAgentRuntime,
  type AgentRuntime,
} from "../../../apps/moontide/src/agent/runtime/index.js";
import { getWorkdir } from "../../../apps/moontide/src/config.js";
import { registerBuiltinWorkMemPorts } from "../../../apps/moontide/src/plugins/builtin/work-mem/register.js";
import { resetAlwaysAllowOverride } from "../../../apps/moontide/src/tools/always-allow-mode.js";
import { setHttpFetchExecutor } from "@moontide/tools";

import { evalHttpFetchExecutor } from "./http-fixtures.js";

let active: AgentRuntime | undefined;
let httpFixturesInstalled = false;

/** Install an isolated AgentRuntime for eval runs (hooks + default tools). */
export function installEvalRuntime(workdir = getWorkdir()): AgentRuntime {
  registerBuiltinWorkMemPorts();
  const runtime = createAgentRuntime();
  setAgentRuntime(runtime);
  runtime.registerDefaultSidecarHooks(workdir);
  active = runtime;
  return runtime;
}

export function installEvalHttpReplay(): void {
  if (!httpFixturesInstalled) {
    setHttpFetchExecutor(evalHttpFetchExecutor);
    httpFixturesInstalled = true;
  }
}

export function clearEvalRuntime(): void {
  active?.reset();
  setAgentRuntime(undefined);
  active = undefined;
  resetAlwaysAllowOverride();
  delete process.env.MOONTIDE_ALWAYS_ALLOW;
  if (httpFixturesInstalled) {
    setHttpFetchExecutor(undefined);
    httpFixturesInstalled = false;
  }
}
