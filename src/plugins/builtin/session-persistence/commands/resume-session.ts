import { AgentSession } from "../../../../agent/agent-session.js";
import { resetRuntimeStatus } from "../../../../agent/context-status.js";
import { getAgentRuntime } from "../../../../agent/runtime/index.js";
import { createSessionStores } from "../../../../session/stores/index.js";
import type { ParsedReplParts, ReplCommandResult, SessionPersistenceDeps } from "../deps.js";
import { sessionExists } from "../session-index.js";

export async function handleResumeSessionCommand(
  parsed: ParsedReplParts,
  deps: SessionPersistenceDeps,
): Promise<ReplCommandResult> {
  const sessionId = parsed.parts[2];
  if (!sessionId) {
    deps.reply("usage: /resume session <session-id> [checkpoint-id]");
    return "handled";
  }

  if (!sessionExists(deps.workdir, sessionId)) {
    deps.reply(`session not found: ${sessionId}`);
    return "handled";
  }

  const checkpointId = parsed.parts[3];
  if (checkpointId) {
    const checkpoint = await createSessionStores(deps.workdir).checkpoints.get(
      sessionId,
      checkpointId,
    );
    if (!checkpoint) {
      deps.reply(`checkpoint not found: ${checkpointId}`);
      return "handled";
    }
  }

  const agent = await AgentSession.open(
    sessionId,
    deps.workdir,
    { resumeFromCheckpointId: checkpointId },
    getAgentRuntime(),
  );

  resetRuntimeStatus();
  deps.setAgentSession(agent);

  const messageCount = agent.session.getMessages().length;
  if (checkpointId) {
    deps.reply(
      `loaded session ${sessionId} · ${messageCount} messages visible · checkpoint ${checkpointId}`,
    );
    return "handled";
  }

  deps.reply(`loaded session ${sessionId} · ${messageCount} messages visible`);
  return "handled";
}
