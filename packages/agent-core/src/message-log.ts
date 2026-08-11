import type { AgentMessage, RunEvent } from "@moontide/run-protocol";

export interface MessageLog {
  readonly messages: readonly AgentMessage[];
  /** Append and return paired message_start/message_end events. */
  append(message: AgentMessage): RunEvent[];
  /** Record only (caller already published streaming lifecycle). */
  push(message: AgentMessage): void;
}

export function createMessageLog(): MessageLog {
  const messages: AgentMessage[] = [];
  return {
    get messages() {
      return messages as readonly AgentMessage[];
    },
    append(message: AgentMessage) {
      messages.push(message);
      return [
        { type: "message_start", message },
        { type: "message_end", message },
      ];
    },
    push(message: AgentMessage) {
      messages.push(message);
    },
  };
}
