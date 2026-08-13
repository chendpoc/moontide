import {
  AgentSession,
  ensureDebugLogFile,
  getWorkdir,
  isDebugFileEnabled,
  resetDebugLogKey,
  resetRuntimeStatus,
  setDebugLogKey,
} from "@moontide/agent";
import { ensureSessionLogFile } from "@moontide/session";

let replAgentSession: AgentSession | null = null;

function ensureReplSessionFiles(agentSession: AgentSession): void {
  const workdir = getWorkdir();
  const sessionId = agentSession.session.sessionId;
  ensureSessionLogFile(workdir, sessionId);
  setDebugLogKey(sessionId);
  if (isDebugFileEnabled()) {
    ensureDebugLogFile(workdir);
  }
}

export function getReplAgentSession(): AgentSession | null {
  return replAgentSession;
}

/** Create REPL session on startup or first prompt; materialize session + debug log files. */
export function getOrStartReplSession(): AgentSession {
  if (replAgentSession) {
    return replAgentSession;
  }
  resetRuntimeStatus();
  replAgentSession = AgentSession.create(getWorkdir());
  ensureReplSessionFiles(replAgentSession);
  return replAgentSession;
}

export function startReplSession(): AgentSession {
  replAgentSession = AgentSession.create(getWorkdir());
  ensureReplSessionFiles(replAgentSession);
  return replAgentSession;
}

export function setReplAgentSession(session: AgentSession | null): void {
  replAgentSession = session;
  if (session) {
    ensureReplSessionFiles(session);
  } else {
    resetDebugLogKey();
  }
}

export function resetReplSession(): void {
  replAgentSession = null;
  resetDebugLogKey();
}
