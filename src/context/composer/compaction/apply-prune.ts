import type { Message, ToolSchema } from "../../../llm/protocol/types.js";
import { estimateBreakdown } from "../../../context-inspect/metrics.js";
import { estimateDialogueTokens } from "../budget/estimate.js";

const COMPACT_PLACEHOLDER_PREFIX = "[compact:";

export interface PruneResult {
  messages: Message[];
  beforeTokens: number;
  afterTokens: number;
  truncatedToolResults: number;
  changed: boolean;
  keepFromIndex: number;
}

function estimateMessagesDialogueTokens(messages: Message[], modelId: string): number {
  return estimateDialogueTokens(messages, modelId);
}

/** Legacy full-window estimate (system + tools + messages); prefer L2 dialogue for compaction metrics. */
function estimateMessagesTokens(
  messages: Message[],
  system: string,
  tools: ToolSchema[],
  modelId: string,
): number {
  const snapshot = {
    turn: 0,
    messages,
    system,
    tools,
    modelId,
  };
  return estimateBreakdown(snapshot).total;
}

function isToolResultsOnly(content: Message["content"]): boolean {
  if (typeof content === "string") {
    return false;
  }
  if (!Array.isArray(content) || content.length === 0) {
    return false;
  }
  return content.every((block) => block.type === "tool_result");
}

function isUserTextTurnStart(message: Message): boolean {
  if (message.role !== "user") {
    return false;
  }
  return !isToolResultsOnly(message.content);
}

export function findKeepFromIndex(messages: Message[], keepTurns: number): number {
  let userTurns = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!isUserTextTurnStart(messages[i])) {
      continue;
    }
    userTurns += 1;
    if (userTurns >= keepTurns) {
      return i;
    }
  }
  return 0;
}

function shrinkToolResultContent(content: string, toolHint?: string): string {
  if (content.startsWith(COMPACT_PLACEHOLDER_PREFIX)) {
    return content;
  }
  const hint = toolHint ? `, tool=${toolHint}` : "";
  return `${COMPACT_PLACEHOLDER_PREFIX} ${content.length} chars omitted${hint}]`;
}

function shrinkMessageToolResults(message: Message): {
  message: Message;
  truncated: number;
} {
  if (message.role !== "user" || typeof message.content === "string") {
    return { message, truncated: 0 };
  }
  if (!Array.isArray(message.content)) {
    return { message, truncated: 0 };
  }

  let truncated = 0;
  const content = message.content.map((block) => {
    if (block.type !== "tool_result") {
      return block;
    }
    const body = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
    if (body.length <= 120 || body.startsWith(COMPACT_PLACEHOLDER_PREFIX)) {
      return block;
    }
    truncated += 1;
    return {
      ...block,
      content: shrinkToolResultContent(body),
    };
  });

  return { message: { ...message, content }, truncated };
}

function stripThinkingFromAssistant(message: Message): Message {
  if (message.role !== "assistant" || typeof message.content === "string") {
    return message;
  }
  if (!Array.isArray(message.content)) {
    return message;
  }
  const content = message.content.filter((block) => block.type !== "thinking");
  return { ...message, content };
}

/** Shrink old tool results and strip thinking blocks (immutable). */
export function applyPrune(
  messages: Message[],
  system: string,
  tools: ToolSchema[],
  keepTurns: number,
  modelId: string,
): PruneResult {
  if (messages.length === 0) {
    return {
      messages,
      beforeTokens: 0,
      afterTokens: 0,
      truncatedToolResults: 0,
      changed: false,
      keepFromIndex: 0,
    };
  }

  const beforeTokens = estimateMessagesDialogueTokens(messages, modelId);
  const keepFrom = findKeepFromIndex(messages, keepTurns);
  let truncatedToolResults = 0;

  const next = messages.map((message, index) => {
    let current = message;
    if (index < keepFrom) {
      const shrunk = shrinkMessageToolResults(current);
      current = stripThinkingFromAssistant(shrunk.message);
      truncatedToolResults += shrunk.truncated;
      return current;
    }
    return current;
  });

  const afterTokens = estimateMessagesDialogueTokens(next, modelId);
  const changed = afterTokens < beforeTokens || truncatedToolResults > 0;

  return {
    messages: next,
    beforeTokens,
    afterTokens,
    truncatedToolResults,
    changed,
    keepFromIndex: keepFrom,
  };
}

export function estimateContextTokens(
  messages: Message[],
  system: string,
  tools: ToolSchema[],
  modelId: string,
): number {
  return estimateMessagesTokens(messages, system, tools, modelId);
}

/** L2 dialogue tokens for compaction before/after reports (matches auto-prune threshold scope). */
export function estimateDialogueCompactionTokens(messages: Message[], modelId: string): number {
  return estimateMessagesDialogueTokens(messages, modelId);
}
