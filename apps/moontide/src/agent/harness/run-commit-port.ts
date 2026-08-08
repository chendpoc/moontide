import type { AgentMessage, RunEvent } from "@moontide/agent-common";
import type { RunEventListener } from "@moontide/agent-core";
import type { Session } from "@moontide/session";
import {
  assistantMessageToContentBlocks,
  toolResultToSummary,
  userMessageToSessionText,
} from "./message-map.js";

export interface RunCommitPortOptions {
  session: Session;
}

/** Commit semantic message_end events to Session Item Log (M5 harness bridge). */
export function createRunCommitPort(options: RunCommitPortOptions): RunEventListener {
  const { session } = options;
  let activeTurn = 0;

  return (event: RunEvent) => {
    if (event.type === "turn_start") {
      activeTurn += 1;
      return;
    }
  if (event.type !== "message_end") {
    return;
  }
  if (event.message.role === "toolResult") {
    return;
  }
  void _commitMessage(session, event.message, activeTurn);
  };
}

async function _commitMessage(
  session: Session,
  message: AgentMessage,
  activeTurn: number,
): Promise<void> {
  const turn = message.role === "user" && activeTurn === 0 ? 1 : activeTurn;

  if (message.role === "user") {
    await session.appendUser(turn, userMessageToSessionText(message));
    return;
  }

  if (message.role === "assistant") {
    await session.appendAssistant(turn, assistantMessageToContentBlocks(message));
    return;
  }

  await session.appendToolOutcome(turn, message.toolCallId, toolResultToSummary(message));
}
