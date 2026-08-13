/**
 * @deprecated Use createReplRunEventProjection from cli/repl/run-event-projection.js
 */
import type { RunEventListener } from "@moontide/agent";
import { extractTextReply } from "@moontide/agent";
import type { RunEvent } from "@moontide/run-protocol";

export interface ReplConversationStreamListener {
  listener: RunEventListener;
  hadOutput: () => boolean;
}

/** @deprecated Prefer createReplRunEventProjection + ReplTerminal */
export function createReplConversationStreamListener(options: {
  onText: (text: string) => void;
}): ReplConversationStreamListener {
  let output = false;

  const listener: RunEventListener = (event: RunEvent) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") {
      return;
    }
    const text = extractTextReply(event.message);
    if (text.length === 0) {
      return;
    }
    output = true;
    options.onText(text);
  };

  return {
    listener,
    hadOutput: () => output,
  };
}
