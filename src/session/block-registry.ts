import type { ContentBlock } from "../llm/protocol/types.js";
import type { EventDraft } from "../log/types.js";
import { truncateOneLine } from "../utils/text.js";

const PREVIEW_LIMIT = 48;

/** Per-block detail for context inspection / token breakdown. */
export interface MessageLineDetail {
  kind: "tool_result" | "tool_use" | "text" | "thinking";
  tokens: number;
  charCount: number;
  toolUseId?: string;
  toolName?: string;
  preview: string;
  body?: string;
}

export type GenericBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  tool_use_id?: string;
};

export type TokenSlice = {
  user: number;
  assistant: number;
  thinking: number;
  toolResults: number;
  toolCalls: number;
  maxToolResultChars: number;
};

const EMPTY_TOKENS: TokenSlice = {
  user: 0,
  assistant: 0,
  thinking: 0,
  toolResults: 0,
  toolCalls: 0,
  maxToolResultChars: 0,
};

type KnownBlockType = ContentBlock["type"];

interface BlockHandler {
  estimateTokens(block: GenericBlock): TokenSlice;
  toMessageLineDetail(block: GenericBlock, part: TokenSlice): MessageLineDetail;
  toMessageLabel(block: GenericBlock, part: TokenSlice): string;
  toMessagePreview(block: GenericBlock, part: TokenSlice): string;
  mapFromExternal?(block: GenericBlock): ContentBlock[];
  toTraceDraft?(block: ContentBlock, turn: number): EventDraft | null;
}

export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateJsonTokens(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  return estimateTextTokens(JSON.stringify(value));
}

function previewText(text: string): string {
  return truncateOneLine(text, PREVIEW_LIMIT, "...");
}

function blockContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(content ?? "");
}

function formatToolResultPreview(toolUseId: string | undefined, content: string): string {
  const snippet = previewText(content);
  if (!toolUseId) {
    return snippet;
  }
  const shortId = toolUseId.length > 10 ? `${toolUseId.slice(0, 10)}…` : toolUseId;
  return `${shortId} · ${snippet}`;
}

const BLOCK_HANDLERS: Record<KnownBlockType, BlockHandler> = {
  text: {
    estimateTokens(block) {
      return { ...EMPTY_TOKENS, assistant: estimateTextTokens(block.text ?? "") };
    },
    toMessageLineDetail(block, part) {
      return {
        kind: "text",
        tokens: part.assistant,
        charCount: (block.text ?? "").length,
        preview: previewText(block.text ?? ""),
        body: block.text ?? "",
      };
    },
    toMessageLabel(_block, part) {
      return `text:${part.assistant}`;
    },
    toMessagePreview(block) {
      return previewText(block.text ?? "");
    },
    mapFromExternal(block) {
      if (block.type !== "text" || block.text === undefined) {
        return [];
      }
      return [{ type: "text", text: block.text }];
    },
    toTraceDraft(block, turn) {
      if (block.type !== "text") {
        return null;
      }
      return {
        turn,
        phase: "post_llm",
        channel: "trace",
        kind: "assistant_text",
        payload: { body: block.text, charCount: block.text.length },
        preview: truncateOneLine(block.text),
      };
    },
  },
  thinking: {
    estimateTokens(block) {
      return { ...EMPTY_TOKENS, thinking: estimateTextTokens(block.thinking ?? "") };
    },
    toMessageLineDetail(block, part) {
      return {
        kind: "thinking",
        tokens: part.thinking,
        charCount: (block.thinking ?? "").length,
        preview: "(thinking)",
        body: block.thinking ?? "",
      };
    },
    toMessageLabel(_block, part) {
      return `thinking:${part.thinking}`;
    },
    toMessagePreview() {
      return "(thinking)";
    },
    mapFromExternal(block) {
      if (block.type !== "thinking" || block.thinking === undefined) {
        return [];
      }
      return [{ type: "thinking", thinking: block.thinking }];
    },
    toTraceDraft(block, turn) {
      if (block.type !== "thinking") {
        return null;
      }
      return {
        turn,
        phase: "post_llm",
        channel: "trace",
        kind: "thinking",
        payload: { body: block.thinking, charCount: block.thinking.length },
        preview: truncateOneLine(block.thinking),
      };
    },
  },
  tool_use: {
    estimateTokens(block) {
      return {
        ...EMPTY_TOKENS,
        assistant: estimateJsonTokens({ type: "tool_use", name: block.name, input: block.input }),
        toolCalls: 1,
      };
    },
    toMessageLineDetail(block, part) {
      const toolName = block.name ?? "unknown";
      return {
        kind: "tool_use",
        tokens: part.assistant,
        charCount: JSON.stringify({ type: "tool_use", name: block.name, input: block.input }).length,
        toolName,
        preview: `tool_use:${toolName}`,
      };
    },
    toMessageLabel(block) {
      return `tool_use:${block.name ?? "unknown"}`;
    },
    toMessagePreview(block) {
      return `tool_use:${block.name ?? "unknown"}`;
    },
    mapFromExternal(block) {
      if (block.type !== "tool_use" || !block.id || !block.name) {
        return [];
      }
      return [
        {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        },
      ];
    },
  },
  tool_result: {
    estimateTokens(block) {
      const content = blockContentText(block.content);
      return {
        ...EMPTY_TOKENS,
        toolResults: estimateTextTokens(content),
        maxToolResultChars: content.length,
      };
    },
    toMessageLineDetail(block, part) {
      const content = blockContentText(block.content);
      return {
        kind: "tool_result",
        tokens: part.toolResults,
        charCount: content.length,
        toolUseId: block.tool_use_id,
        preview: previewText(content),
        body: content,
      };
    },
    toMessageLabel(_block, part) {
      return `tool_result:${part.toolResults}`;
    },
    toMessagePreview(block) {
      return formatToolResultPreview(block.tool_use_id, blockContentText(block.content));
    },
  },
};

function handlerFor(block: GenericBlock): BlockHandler | undefined {
  const type = block.type;
  if (type && type in BLOCK_HANDLERS) {
    return BLOCK_HANDLERS[type as KnownBlockType];
  }
  return undefined;
}

export function estimateBlockTokens(block: GenericBlock): TokenSlice {
  const handler = handlerFor(block);
  if (handler) {
    return handler.estimateTokens(block);
  }
  return { ...EMPTY_TOKENS, assistant: estimateJsonTokens(block) };
}

export function blockMessageLineDetail(
  block: GenericBlock,
  part: TokenSlice,
): MessageLineDetail | null {
  const handler = handlerFor(block);
  return handler?.toMessageLineDetail(block, part) ?? null;
}

export function blockMessageLabel(block: GenericBlock, part: TokenSlice): string {
  const handler = handlerFor(block);
  return handler?.toMessageLabel(block, part) ?? block.type ?? "unknown";
}

export function blockMessagePreview(block: GenericBlock, part: TokenSlice): string {
  const handler = handlerFor(block);
  return handler?.toMessagePreview(block, part) ?? block.type ?? "unknown";
}

/** Map externally-shaped content blocks (e.g. adapter output) to MoonTide protocol blocks. */
export function mapContentBlocks(blocks: GenericBlock[]): ContentBlock[] {
  return blocks.flatMap((block) => {
    const handler = handlerFor(block);
    return handler?.mapFromExternal?.(block) ?? [];
  });
}

export function traceDraftsFromBlocks(blocks: ContentBlock[], turn: number): EventDraft[] {
  const drafts: EventDraft[] = [];
  for (const block of blocks) {
    const handler = BLOCK_HANDLERS[block.type];
    const draft = handler.toTraceDraft?.(block, turn);
    if (draft) {
      drafts.push(draft);
    }
  }
  return drafts;
}
