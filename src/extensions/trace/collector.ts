import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { LLMCallRecord, ToolUseRecord } from "../../agent/pipeline/types.js";
import { toolResultContent } from "../../agent/pipeline/tool-result.js";
import type { EventDraft } from "../../events/types.js";
import { truncateOneLine } from "../../utils/text.js";

function previewInput(input: Record<string, unknown>): string {
  const parts = Object.entries(input)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value).slice(0, 30)}`);
  return parts.join(" ");
}

export function collectFromResponse(
  response: { content?: ContentBlock[] },
  turn: number,
): EventDraft[] {
  const drafts: EventDraft[] = [];
  const content = response.content ?? [];

  for (const block of content) {
    if (block.type === "thinking") {
      drafts.push({
        turn,
        phase: "post_llm",
        channel: "trace",
        kind: "thinking",
        payload: {
          body: block.thinking,
          charCount: block.thinking.length,
        },
        preview: truncateOneLine(block.thinking),
      });
      continue;
    }

    if (block.type === "text") {
      drafts.push({
        turn,
        phase: "post_llm",
        channel: "trace",
        kind: "assistant_text",
        payload: {
          body: block.text,
          charCount: block.text.length,
        },
        preview: truncateOneLine(block.text),
      });
      continue;
    }

    if (block.type === "tool_use") {
      const input = block.input as Record<string, unknown>;
      drafts.push({
        turn,
        phase: "post_llm",
        channel: "trace",
        kind: "tool_use",
        payload: {
          body: JSON.stringify(input),
          toolName: block.name,
          toolUseId: block.id,
          charCount: JSON.stringify(input).length,
          input,
        },
        preview: `${block.name} ${previewInput(input)}`.trim(),
      });
    }
  }

  return drafts;
}

export function collectFromLLMCall(record: LLMCallRecord): EventDraft[] {
  if (record.outcome.status === "failed") {
    return [];
  }
  return collectFromResponse(record.outcome.response, record.turn);
}

export function collectFromToolUse(record: ToolUseRecord): EventDraft[] {
  const body = toolResultContent(record.outcome);
  return [
    {
      turn: record.turn,
      phase: "post_tool",
      channel: "trace",
      kind: "tool_result",
      payload: {
        body,
        toolName: record.toolName,
        toolUseId: record.toolUseId,
        charCount: body.length,
        status: record.outcome.status,
      },
      preview: truncateOneLine(body),
    },
  ];
}

