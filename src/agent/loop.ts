import { resetSession } from "../context/sessions.js";
import { setupEventPipeline } from "../log/setup.js";
import { AgentSession } from "./agent-session.js";
import { createDefaultLoopContext } from "./deps.js";
import type { LoopContext } from "./deps.js";
import { createDefaultRunHooks } from "./run-hooks.js";

export async function runAgent(userPrompt: string): Promise<string> {
  setupEventPipeline();
  resetSession();
  const agentSession = AgentSession.create();
  const { reply } = await agentSession.run(
    userPrompt,
    createDefaultLoopContext(agentSession.session),
    createDefaultRunHooks(),
  );
  return reply;
}

export async function continueReplAgent(
  userPrompt: string,
  agentSession: AgentSession,
  loopCtx: LoopContext,
  preparedRunId?: string,
): Promise<{ reply: string; turn: number }> {
  return agentSession.run(userPrompt, loopCtx, createDefaultRunHooks(preparedRunId));
}
