import { internalError } from "@moontide/shared/errors/factories.js";
import type { Message, ToolSchema } from "@moontide/llm/protocol";
import { summarizeCompact, type CompactResult } from "./operations.js";
import type { TextCompletionPort } from "../ports/text-completion.js";
import type { CompactionSave } from "@moontide/session/stores";
import { messagesFromContext } from "@moontide/session";
import type { SessionMessage } from "@moontide/session";
import { newEventId } from "@moontide/shared/utils/id.js";

export interface SummaryCompactionInput {
  sessionId: string;
  turn: number;
  sessionMessages: readonly SessionMessage[];
  system: string;
  tools: ToolSchema[];
  keepTurns: number;
  modelId: string;
  textCompletion: TextCompletionPort;
}

export interface SummaryCompactionResult {
  save: CompactionSave;
  beforeTokens: number;
  afterTokens: number;
  keepFromIndex: number;
}

/** Map protocol keepFrom index → SessionMessage ids covered by summary. */
export function coversItemIdsForKeepFrom(
  sessionMessages: readonly SessionMessage[],
  keepFromProtocolIndex: number,
): string[] {
  if (keepFromProtocolIndex <= 0 || sessionMessages.length === 0) {
    return [];
  }

  const covered: string[] = [];
  for (let i = 0; i < sessionMessages.length; i += 1) {
    const projected = messagesFromContext({ messages: sessionMessages.slice(0, i + 1) });
    if (projected.length < keepFromProtocolIndex) {
      covered.push(sessionMessages[i]!.id);
    } else {
      break;
    }
  }
  return covered;
}

function extractSummaryText(messages: Message[]): string {
  const first = messages[0];
  if (!first || first.role !== "user") {
    return "";
  }
  const body = typeof first.content === "string" ? first.content : "";
  const prefix = "[Session summary — older turns compressed]\n";
  return body.startsWith(prefix) ? body.slice(prefix.length) : body;
}

/** LLM summary → CompactionSave (does not mutate SessionContext). */
export async function runSummaryCompaction(
  input: SummaryCompactionInput,
): Promise<SummaryCompactionResult> {
  const messageParams = messagesFromContext({ messages: input.sessionMessages });
  const compactResult: CompactResult = await summarizeCompact(
    messageParams,
    input.system,
    input.tools,
    { keepTurns: input.keepTurns, modelId: input.modelId },
    input.textCompletion,
  );

  if (!compactResult.changed) {
    throw internalError("Nothing to summarize — keep window already covers full history");
  }

  const summaryText = extractSummaryText(compactResult.messages);
  const coversItemIds = coversItemIdsForKeepFrom(
    input.sessionMessages,
    compactResult.keepFromIndex,
  );

  const save: CompactionSave = {
    id: newEventId(),
    sessionId: input.sessionId,
    createdAtTurn: input.turn,
    kind: "summary",
    coversItemIds,
    payload: { text: summaryText },
  };

  return {
    save,
    beforeTokens: compactResult.beforeTokens,
    afterTokens: compactResult.afterTokens,
    keepFromIndex: compactResult.keepFromIndex,
  };
}
