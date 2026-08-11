import {
  createAgentRuntime,
  setAgentRuntime,
  setupEvalHarness,
  type AgentRuntime,
} from "@moontide/agent";
import { getWorkdir } from "@moontide/agent";
import { resetAlwaysAllowOverride } from "@moontide/agent";
import { setHttpFetchExecutor } from "@moontide/tools";

import { evalHttpFetchExecutor } from "./http-fixtures.js";

let active: AgentRuntime | undefined;
let httpFixturesInstalled = false;

/** Install an isolated AgentRuntime for eval runs (hooks + default tools + eval pipeline). */
export function installEvalRuntime(workdir = getWorkdir()): AgentRuntime {
  const runtime = createAgentRuntime();
  setAgentRuntime(runtime);
  setupEvalHarness(runtime, workdir);
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
