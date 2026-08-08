import type { Message, ToolSchema } from "@moontide/llm/protocol";
import {
  estimateJsonTokens,
  estimateTextTokens,
} from "@moontide/session/block-registry";
import { isReferenceToolResultBody } from "./reference-classify.js";

export { isReferenceToolResultBody } from "./reference-classify.js";
export {
  isCompactToolResultBody,
  isSpilledToolResultBody,
} from "./reference-classify.js";

export const COMPACT_PLACEHOLDER_PREFIX = "[compact:";
export const ARTIFACT_FOOTNOTE_PREFIX = "[artifact:";

function toolResultBody(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

function splitMessageTokens(message: Message): { dialogue: number; reference: number } {
  let dialogue = 0;
  let reference = 0;

  if (typeof message.content === "string") {
    dialogue += estimateTextTokens(message.content);
    return { dialogue, reference };
  }

  if (!Array.isArray(message.content)) {
    return { dialogue, reference };
  }

  for (const block of message.content) {
    if (block.type === "thinking") {
      dialogue += estimateTextTokens(block.thinking);
    } else if (block.type === "text") {
      dialogue += estimateTextTokens(block.text);
    } else if (block.type === "tool_result") {
      const body = toolResultBody(block.content);
      const tokens = estimateTextTokens(body);
      if (isReferenceToolResultBody(body)) {
        reference += tokens;
      } else {
        dialogue += tokens;
      }
    }
  }

  return { dialogue, reference };
}

/** L1: system + tool definitions (no messages). */
export function estimatePinnedTokens(
  system: string,
  tools: ToolSchema[],
  modelId: string,
): number {
  void modelId;
  return estimateTextTokens(system) + estimateJsonTokens(tools);
}

/** L3: spilled / compact tool_result bodies only. */
export function estimateReferenceTokens(messages: Message[], modelId: string): number {
  void modelId;
  return messages.reduce((sum, message) => sum + splitMessageTokens(message).reference, 0);
}

/** L2: user / assistant / thinking + inline (non-reference) tool_result bodies. */
export function estimateDialogueTokens(messages: Message[], modelId: string): number {
  void modelId;
  return messages.reduce((sum, message) => sum + splitMessageTokens(message).dialogue, 0);
}

/** Legacy total for debug; prefer tier-specific estimators for budgeting. */
export function estimateInputTokens(
  messages: Message[],
  system: string,
  tools: ToolSchema[],
  modelId: string,
): number {
  void modelId;
  return (
    estimateTextTokens(system) +
    estimateJsonTokens(tools) +
    estimateDialogueTokens(messages, modelId) +
    estimateReferenceTokens(messages, modelId)
  );
}
