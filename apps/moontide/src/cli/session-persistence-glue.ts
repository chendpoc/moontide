import { getWorkdir } from "../config.js";
import { reply } from "./commands/io.js";
import type { ReplCommandContext } from "./commands/types.js";
import type { SessionPersistenceDeps } from "../plugins/builtin/session-persistence/index.js";
import { getReplAgentSession, setReplAgentSession } from "./repl/session.js";

export function createSessionPersistenceDeps(ctx: ReplCommandContext): SessionPersistenceDeps {
  return {
    workdir: getWorkdir(),
    getAgentSession: () => ctx.getAgentSession(),
    setAgentSession: setReplAgentSession,
    reply,
  };
}

export function createReplSessionPersistenceDeps(): SessionPersistenceDeps {
  return {
    workdir: getWorkdir(),
    getAgentSession: getReplAgentSession,
    setAgentSession: setReplAgentSession,
    reply,
  };
}
