import { getWorkdir, type SessionLifecycleAccess } from "@moontide/agent";
import type { ReplCommandContext } from "./commands/types.js";
import { getReplAgentSession, setReplAgentSession } from "./repl/session.js";

export function createSessionPersistenceAccess(ctx: ReplCommandContext): SessionLifecycleAccess {
  return {
    workdir: getWorkdir(),
    getAgentSession: () => ctx.getAgentSession(),
    setAgentSession: setReplAgentSession,
  };
}

export function createReplSessionLifecycleAccess(): SessionLifecycleAccess {
  return {
    workdir: getWorkdir(),
    getAgentSession: getReplAgentSession,
    setAgentSession: setReplAgentSession,
  };
}
