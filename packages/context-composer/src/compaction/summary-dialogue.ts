import type { Message } from "@moontide/llm/protocol";
import type { TextCompletionPort } from "../ports/text-completion.js";

export const DIALOGUE_SUMMARY_SYSTEM =
  "Summarize the conversation excerpt for context compression. Preserve tasks, decisions, file paths, and open questions. Be concise.";

export const DIALOGUE_SUMMARY_MAX_TOKENS = 2000;

/** Serialize protocol messages for summary LLM input. */
export function formatMessagesForSummary(messages: readonly Message[]): string {
  return messages
    .map((message, index) => {
      const role = message.role;
      const body =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content).slice(0, 4000);
      return `[${index}] ${role}: ${body}`;
    })
    .join("\n\n");
}

/** LLM summary for a dialogue excerpt (compaction algorithm; I/O via port). */
export async function summarizeDialogueExcerpt(
  messages: readonly Message[],
  textCompletion: TextCompletionPort,
): Promise<string> {
  return textCompletion.complete({
    system: DIALOGUE_SUMMARY_SYSTEM,
    user: formatMessagesForSummary(messages),
    maxTokens: DIALOGUE_SUMMARY_MAX_TOKENS,
  });
}
