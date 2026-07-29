import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { EventDraft } from "../../events/types.js";

function truncate(text: string, max = 40): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1)}…`;
}

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
        preview: truncate(block.thinking),
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
        preview: truncate(block.text),
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

export function collectFromToolResult(ctx: Record<string, unknown>): EventDraft[] {
  const turn = Number(ctx.turn ?? 0);
  const toolName = String(ctx.tool_name ?? "tool");
  const output = String(ctx.output ?? "");
  const toolUseId = ctx.tool_use_id ? String(ctx.tool_use_id) : undefined;

  return [
    {
      turn,
      phase: "post_tool",
      channel: "trace",
      kind: "tool_result",
      payload: {
        body: output,
        toolName,
        toolUseId,
        charCount: output.length,
      },
      preview: truncate(output),
    },
  ];
}

/** Convenience wrapper used by trace register slot. */
export function collectToolResult(
  turn: number,
  toolName: string,
  toolUseId: string,
  output: string,
): EventDraft {
  return collectFromToolResult({
    turn,
    tool_name: toolName,
    tool_use_id: toolUseId,
    output,
  })[0]!;
}
