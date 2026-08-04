import { getWorkdir } from "../config.js";
import { resetRuntimeStatus } from "./context-status.js";
import { bootstrapAgentPlatform } from "../app/bootstrap.js";
import { AgentSession } from "./agent-session.js";
import { createDefaultLoopContext } from "./deps.js";
import type { LoopContext } from "./deps.js";
import { prepareRun } from "./hooks/index.js";
import { getAgentRuntime } from "./runtime/index.js";

export async function runAgent(userPrompt: string): Promise<string> {
  const runtime = getAgentRuntime();
  await bootstrapAgentPlatform(getWorkdir(), runtime);
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
): Promise<{ reply: string; turn: number }> {
  prepareRun(preparedRunId);
  return agentSession.run(userPrompt, loopCtx);
}
