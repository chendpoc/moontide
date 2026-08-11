import type { AgentEventOutputs } from "./event-outputs.js";
import type { AgentRunExecuteOptions } from "./agent-run.js";
import { getWorkdir } from "../config.js";
import { resetRuntimeStatus } from "./context-status.js";
import { bootstrapAgentPlatform } from "../app/bootstrap.js";
import { AgentSession } from "./agent-session.js";
import { createDefaultLoopContext } from "./deps.js";
import type { LoopContext } from "./deps.js";
import { prepareRun } from "./run-observers/index.js";
import { getAgentRuntime } from "./runtime/index.js";
import { setupToolsPorts } from "./tools-setup.js";

export async function runAgent(
  userPrompt: string,
  eventOutputs: AgentEventOutputs,
): Promise<string> {
  setupToolsPorts();
  const runtime = getAgentRuntime();
  await bootstrapAgentPlatform({
    workdir: getWorkdir(),
    runtime,
    eventOutputs,
  });
  resetRuntimeStatus();
  prepareRun();
  const agentSession = AgentSession.create(getWorkdir(), runtime);
  const { reply } = await agentSession.run(
    userPrompt,
    createDefaultLoopContext(agentSession.session, runtime),
  );
  return reply;
}

export async function continueReplAgent(
  userPrompt: string,
  agentSession: AgentSession,
  loopCtx: LoopContext,
  preparedRunId?: string,
  executeOptions: AgentRunExecuteOptions = {},
): Promise<{ reply: string; turn: number }> {
  prepareRun(preparedRunId);
  return agentSession.run(userPrompt, loopCtx, executeOptions);
}
