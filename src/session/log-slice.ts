import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import {
  logToMessages,
  type LogToMessagesOptions,
} from "../context/composer/messages/log-to-messages.js";
import { toMessageParams } from "../context/composer/messages/to-message-params.js";
import type { Message } from "../llm/protocol/types.js";
import type { SessionLog } from "./log-types.js";
import type { Session } from "./session.js";

/** Read-only view of a session log for replay into LLM input. */
export class SessionLogSlice {
  constructor(private readonly log: readonly SessionLog[]) {}

  static fromLog(log: readonly SessionLog[]): SessionLogSlice {
    return new SessionLogSlice(log);
  }

  static async fromSession(session: Session): Promise<SessionLogSlice> {
    return new SessionLogSlice(await session.readLog());
  }

  toMessages(options?: LogToMessagesOptions): Message[] {
    return logToMessages(this.log, options);
  }

  toMessageParams(options?: LogToMessagesOptions): MessageParam[] {
    return toMessageParams(this.toMessages(options));
  }
}
