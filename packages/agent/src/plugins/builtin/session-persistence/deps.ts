import type { AgentSession } from "../../../agent/agent-session.js";

/** Harness lifecycle port for session index / resume (no REPL I/O). */
export type SessionLifecycleAccess = {
  workdir: string;
  getAgentSession: () => AgentSession | null;
  setAgentSession?: (session: AgentSession | null) => void;
};

export type SaveSessionOutcome =
  | { ok: true; sessionId: string; messageCount: number }
  | { ok: false; reason: "no_session" | "empty_messages" };

export type ResumeSessionOutcome =
  | { ok: true; sessionId: string; messageCount: number; checkpointId?: string }
  | { ok: false; reason: "session_not_found" | "checkpoint_not_found" };
