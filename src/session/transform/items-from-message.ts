import type { ContentBlock } from "../../llm/protocol/types.js";
import { newEventId } from "../../utils/id.js";
import type { ToolResultSummary } from "../types.js";
import type { SessionItem, SessionMessage } from "../types.js";

import { byteLengthUtf8 } from "../../utils/utf8.js";

function toolResultSummaryFromContent(content: string): ToolResultSummary {
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;
  return {
    summary: content,
    byteCount: byteLengthUtf8(content),
    lineCount,
  };
}

/** One SessionMessage → SessionItem[] for persistence. */
export function itemsFromMessage(message: SessionMessage): SessionItem[] {
  const { sessionId, turn, at } = message;

  if (message.role === "user") {
    if (typeof message.content === "string") {
      return [
        {
          kind: "user_message",
          id: message.id,
          sessionId,
          turn,
          at,
          text: message.content,
        },
      ];
    }

    const toolResults = message.content.filter(
      (block): block is Extract<ContentBlock, { type: "tool_result" }> =>
        block.type === "tool_result",
    );
    if (toolResults.length === message.content.length) {
      return toolResults.map((block) => ({
        kind: "tool_outcome",
        id: newEventId(),
        sessionId,
        turn,
        at,
        toolUseId: block.tool_use_id,
        resultSummary: toolResultSummaryFromContent(
          typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content),
        ),
      }));
    }

    const text = message.content
      .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    return [
      {
        kind: "user_message",
        id: message.id,
        sessionId,
        turn,
        at,
        text,
      },
    ];
  }

  const blocks = Array.isArray(message.content)
    ? message.content
    : [{ type: "text" as const, text: message.content }];

  const items: SessionItem[] = [
    {
      kind: "assistant_message",
      id: message.id,
      sessionId,
      turn,
      at,
      blocks,
    },
  ];

  for (const block of blocks) {
    if (block.type === "tool_use") {
      items.push({
        kind: "tool_invocation",
        id: newEventId(),
        sessionId,
        turn,
        at,
        toolUseId: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }

  return items;
}
