import type { CompactResult } from "../context/compact.js";
import type { ContentBlock as SdkContentBlock } from "@anthropic-ai/sdk/resources/messages/messages.js";

import {
  mapSdkContentBlocks,
  summarizeToolResultContent,
  userMessageText,
} from "./content-map.js";
import type { SessionLogBody } from "./log-types.js";
import type { SessionLogWriter } from "./log-writer.js";
import { buildSessionLog } from "./log.js";

async function appendBody(
  writer: SessionLogWriter | undefined,
  sessionId: string | undefined,
  turn: number,
  body: SessionLogBody,
): Promise<void> {
  if (!writer || !sessionId) {
    return;
  }
  await writer.append(sessionId, buildSessionLog(sessionId, turn, body));
}

export async function logUserMessage(
  writer: SessionLogWriter | undefined,
  sessionId: string | undefined,
  turn: number,
  content: string | SdkContentBlock[],
): Promise<void> {
  await appendBody(writer, sessionId, turn, {
    kind: "user_message",
    text: userMessageText(content),
  });
}

export async function logAssistantMessage(
  writer: SessionLogWriter | undefined,
  sessionId: string | undefined,
  turn: number,
  blocks: SdkContentBlock[],
): Promise<void> {
  await appendBody(writer, sessionId, turn, {
    kind: "assistant_message",
    blocks: mapSdkContentBlocks(blocks),
  });
}

export async function logToolInvocation(
  writer: SessionLogWriter | undefined,
  sessionId: string | undefined,
  turn: number,
  toolUseId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<void> {
  await appendBody(writer, sessionId, turn, {
    kind: "tool_invocation",
    toolUseId,
    name,
    input,
  });
}

export async function logToolOutcome(
  writer: SessionLogWriter | undefined,
  sessionId: string | undefined,
  turn: number,
  toolUseId: string,
  content: string,
): Promise<void> {
  await appendBody(writer, sessionId, turn, {
    kind: "tool_outcome",
    toolUseId,
    resultSummary: summarizeToolResultContent(content),
  });
}

export async function logCompaction(
  writer: SessionLogWriter | undefined,
  sessionId: string | undefined,
  turn: number,
  result: CompactResult,
  compactionKind: "prune" | "tail_window" | "summary" = "prune",
): Promise<void> {
  await appendBody(writer, sessionId, turn, {
    kind: "compaction",
    compactionKind,
    excludedLogIds: [],
    beforeTokens: result.beforeTokens,
    afterTokens: result.afterTokens,
  });
}

export { summarizeToolResultContent };
