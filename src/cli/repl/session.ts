import { AgentSession } from "../../agent/agent-session.js";
import { resetRuntimeStatus } from "../../agent/context-status.js";

let replAgentSession: AgentSession | null = null;

export function getReplAgentSession(): AgentSession | null {
  return replAgentSession;
}

/** First agent prompt: clear global context snapshot, then create REPL session. */
export function getOrStartReplSession(): AgentSession {
  if (replAgentSession) {
    return replAgentSession;
  }
  resetRuntimeStatus();
  replAgentSession = AgentSession.create();
  return replAgentSession;
}

export function startReplSession(): AgentSession {
  replAgentSession = AgentSession.create();
  return replAgentSession;
}

export function setReplAgentSession(session: AgentSession | null): void {
  replAgentSession = session;
}

export function resetReplSession(): void {
  replAgentSession = null;
}
