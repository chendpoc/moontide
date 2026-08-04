import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { toMessageParams } from "../context/composer/messages/to-message-params.js";
import type { Message } from "../llm/protocol/types.js";
import type { Session } from "./session.js";
import { messagesFromItems } from "./transform/messages-from-items.js";
import { itemsFromMessages } from "./transform/items-from-messages.js";
import {
  messagesFromContext,
  type MessagesFromContextOptions,
} from "./transform/messages-from-context.js";
import type { SessionContext, SessionItem } from "./types.js";

export type SaveSessionMode = "append-new" | "append-all" | "replace";

export interface SaveSessionOptions {
  mode?: SaveSessionMode;
}

/** SessionContext ↔ SessionItem ↔ protocol Message. No I/O. */
export class SessionTransform {
  constructor(private readonly context: SessionContext) {}

  static fromContext(context: SessionContext): SessionTransform {
    return new SessionTransform({ messages: [...context.messages] });
  }

  static fromItems(items: readonly SessionItem[]): SessionTransform {
    return new SessionTransform({ messages: messagesFromItems(items) });
  }

  static fromSession(session: Session): SessionTransform {
    return new SessionTransform(session.getContext());
  }

  toContext(): SessionContext {
    return { messages: [...this.context.messages] };
  }

  toItems(): SessionItem[] {
    return itemsFromMessages(this.context.messages);
  }

  toMessages(options?: MessagesFromContextOptions): Message[] {
    return messagesFromContext(this.context, options);
  }

  toMessageParams(options?: MessagesFromContextOptions): MessageParam[] {
    return toMessageParams(this.toMessages(options));
  }

  async saveSession(session: Session, options?: SaveSessionOptions): Promise<void> {
    await session.importItems(this.toItems(), options);
  }
}

export { messagesFromContext, type MessagesFromContextOptions } from "./transform/messages-from-context.js";
export { messagesFromItems } from "./transform/messages-from-items.js";
export { itemsFromMessages } from "./transform/items-from-messages.js";
export { itemsFromMessage } from "./transform/items-from-message.js";
