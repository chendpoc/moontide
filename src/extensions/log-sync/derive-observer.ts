import {
  deriveConversationFinal as deriveFinalReply,
  deriveFromSessionItem,
} from "../../session/item-handlers.js";
import type { HookHandler } from "../../agent/hooks/types.js";

export { deriveFinalReply };

/** Project SessionItem commits into Agent Event Log (fail-open). Sole source for conversation + trace events (C6). */
export function createAgentEventDeriveHandler(): HookHandler<"sessionItem"> {
  return ({ item }) => {
    deriveFromSessionItem(item);
  };
}

export { deriveFromSessionItem };
