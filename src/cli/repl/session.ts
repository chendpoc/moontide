import { AgentSession } from "../../agent/agent-session.js";

let replAgentSession: AgentSession | null = null;

export function hasReplSession(): boolean {
  return replAgentSession !== null;
}

export function getReplAgentSession(): AgentSession | null {
  return replAgentSession;
}

export function startReplSession(): AgentSession {
  replAgentSession = AgentSession.create();
  return replAgentSession;
}

export function resetReplSession(): void {
  replAgentSession = null;
}
