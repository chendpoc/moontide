import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { Message } from "../../../llm/protocol/types.js";

/** SDK boundary: Ocula protocol messages → Anthropic MessageParam[]. */
export function toMessageParams(messages: Message[]): MessageParam[] {
  return messages as MessageParam[];
}
