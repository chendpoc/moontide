import { infraError } from "@moontide/shared/errors/factories.js";

import type { ContentBlock } from "../protocol/types.js";
import { parseToolCallArguments } from "./parse-tool-arguments.js";

export interface ResponsesOutputItem {
  type?: string;
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
}

/** Map Responses API output items to MoonTide content blocks (preserves order). */
export function fromOpenAiResponsesOutput(output: ResponsesOutputItem[] | undefined): ContentBlock[] {
  if (!output || output.length === 0) {
    return [];
  }

  const blocks: ContentBlock[] = [];

  for (const item of output) {
    switch (item.type) {
      case "reasoning": {
        const text = item.content
          ?.filter((part) => part.type === "reasoning_text")
          .map((part) => part.text ?? "")
          .join("\n")
          .trim();
        if (text && text.length > 0) {
          blocks.push({ type: "thinking", thinking: text });
        }
        break;
      }
      case "message": {
        const text = item.content
          ?.filter((part) => part.type === "output_text")
          .map((part) => part.text ?? "")
          .join("\n")
          .trim();
        if (text && text.length > 0) {
          blocks.push({ type: "text", text });
        }
        break;
      }
      case "function_call": {
        const callId = item.call_id;
        const name = item.name;
        if (!callId || !name) {
          throw infraError("Responses function_call missing call_id or name", {
            context: { reason: "llm_malformed_response" },
          });
        }
        blocks.push(parseToolCallArguments(callId, name, item.arguments ?? ""));
        break;
      }
      default:
        break;
    }
  }

  return blocks;
}

export function responsesOutputHasFunctionCall(output: ResponsesOutputItem[] | undefined): boolean {
  return (output ?? []).some((item) => item.type === "function_call");
}
