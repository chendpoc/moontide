import type { RunEvent } from "@moontide/run-protocol";
import { extractTextReply, type RunEventListener } from "@moontide/agent";

export interface ReplConversationStreamListener {
  listener: RunEventListener;
  hadOutput: () => boolean;
}

/** Flush assistant visible text on each message_end (turn-level streaming for REPL stdout). */
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
