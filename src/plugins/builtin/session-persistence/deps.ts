import type { AgentSession } from "../../../agent/agent-session.js";

export type SessionPersistenceDeps = {
  workdir: string;
  getAgentSession: () => AgentSession | null;
  setAgentSession: (session: AgentSession | null) => void;
  reply: (message: string) => void;
};

export type ParsedReplParts = {
  parts: string[];
  arg?: string;
};

export type ReplCommandResult = "handled" | "unknown" | "not_command";
