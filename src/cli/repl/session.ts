import { AgentSession } from "../../agent/agent-session.js";
import { resetSession } from "../../context/sessions.js";

let replAgentSession: AgentSession | null = null;

export function getReplAgentSession(): AgentSession | null {
  return replAgentSession;
}

/** First agent prompt: clear global context snapshot, then create REPL session. */
export function getOrStartReplSession(): AgentSession {
  if (replAgentSession) {
    return replAgentSession;
  }
  resetSession();
  replAgentSession = AgentSession.create();
  return replAgentSession;
}

export function startReplSession(): AgentSession {
  replAgentSession = AgentSession.create();
  return replAgentSession;
}

export function resetReplSession(): void {
  replAgentSession = null;
}
