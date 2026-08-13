import type { RunEvent } from "@moontide/run-protocol";
import { extractTextReply, type RunEventListener } from "@moontide/agent";

import type { ReplTerminal } from "./terminal.js";

export interface ReplRunEventProjection {
  listener: RunEventListener;
  hadOutput: () => boolean;
  resetHadOutput: () => void;
}

/** Sync RunEvent → ReplTerminal transcript (quiet assistant on stderr). */
export function createReplRunEventProjection(terminal: ReplTerminal): ReplRunEventProjection {
  let streamedText = "";
  let hadOutput = false;
  let inAssistant = false;

  const listener: RunEventListener = (event: RunEvent) => {
    if (event.type === "message_start" && event.message.role === "assistant") {
      streamedText = "";
      inAssistant = true;
      terminal.prepareAssistantBlock();
      return;
    }

    if (!inAssistant) {
      return;
    }

    if (event.type === "message_update" && event.delta.kind === "text_delta") {
      streamedText += event.delta.text;
      terminal.onAssistantDelta(event.delta.text);
      if (event.delta.text.length > 0) {
        hadOutput = true;
      }
      return;
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
      const finalText = extractTextReply(event.message);
      if (streamedText.length === 0) {
        terminal.onAssistantEnd(finalText);
      } else if (finalText.startsWith(streamedText)) {
        terminal.onAssistantEnd(finalText.slice(streamedText.length));
      } else {
        terminal.onAssistantMismatch(finalText);
      }
      if (finalText.length > 0 || streamedText.length > 0) {
        hadOutput = true;
      }
      streamedText = "";
      inAssistant = false;
    }
  };

  return {
    listener,
    hadOutput: () => hadOutput,
    resetHadOutput: () => {
      hadOutput = false;
    },
  };
}
