import { AgentSession } from "../../../agent/agent-session.js";
import { resetRuntimeStatus } from "../../../agent/context-status.js";
import { getAgentRuntime } from "../../../agent/runtime/index.js";
import { createSessionStores } from "@moontide/session/stores";

import type {
  ResumeSessionOutcome,
  SaveSessionOutcome,
  SessionLifecycleAccess,
} from "./deps.js";
import { sessionExists, upsertSessionEntry } from "./session-index.js";

/** Upsert the active session into the Session Index. */
export function saveActiveSessionToIndex(access: SessionLifecycleAccess): SaveSessionOutcome {
  const agent = access.getAgentSession();
  if (!agent) {
    return { ok: false, reason: "no_session" };
  }

  const messages = agent.session.getMessages();
  if (messages.length === 0) {
    return { ok: false, reason: "empty_messages" };
  }

  upsertSessionEntry(access.workdir, agent.session.sessionId, {
    messageCount: messages.length,
    lastTurn: messages.at(-1)?.turn ?? 1,
  });

  return {
    ok: true,
    sessionId: agent.session.sessionId,
    messageCount: messages.length,
  };
}

/** Load a session from disk into the REPL via setAgentSession. */
export async function openSessionFromIndex(
  access: SessionLifecycleAccess,
  sessionId: string,
  checkpointId?: string,
): Promise<ResumeSessionOutcome> {
  if (!sessionExists(access.workdir, sessionId)) {
    return { ok: false, reason: "session_not_found" };
  }

  if (checkpointId) {
    const checkpoint = await createSessionStores(access.workdir).checkpoints.get(
      sessionId,
      checkpointId,
    );
    if (!checkpoint) {
      return { ok: false, reason: "checkpoint_not_found" };
    }
  }

  const agent = await AgentSession.open(
    sessionId,
    access.workdir,
    { resumeFromCheckpointId: checkpointId },
    getAgentRuntime(),
  );

  resetRuntimeStatus();
  access.setAgentSession?.(agent);

  const messageCount = agent.session.getMessages().length;
  return {
    ok: true,
    sessionId,
    messageCount,
    checkpointId,
  };
}
