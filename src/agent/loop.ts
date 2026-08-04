import { resetRuntimeStatus } from "../context/runtime-status.js";
import { bootstrapEventPlatform } from "../log/setup.js";
import { AgentSession } from "./agent-session.js";
import { createDefaultLoopContext } from "./deps.js";
import type { LoopContext } from "./deps.js";
import { prepareRun } from "./hooks/index.js";

export async function runAgent(userPrompt: string): Promise<string> {
  await bootstrapEventPlatform();
  resetRuntimeStatus();
  prepareRun();
  const agentSession = AgentSession.create();
  const { reply } = await agentSession.run(
    userPrompt,
    createDefaultLoopContext(agentSession.session),
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
