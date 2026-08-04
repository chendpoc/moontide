import { formatToolSummary } from "../context/composer/artifact/project.js";
import { getWorkdir } from "../config.js";
import type { ContentBlock } from "../llm/protocol/types.js";
import type { Message } from "../llm/protocol/types.js";
import type { RoutingDecision } from "../llm/routing/types.js";
import { newEventId } from "../utils/id.js";
import {
  FileSessionItemReader,
  parseItems,
  readLines,
} from "./io/index.js";
import { hookDispatcher } from "../agent/hooks/index.js";
import { replaceSessionItems } from "../extensions/log-sync/file-item.js";
import { sessionLogPath } from "./paths.js";
import { messagesFromItems } from "./transform/messages-from-items.js";
import { itemsFromMessage } from "./transform/items-from-message.js";
import {
  messagesFromContext,
  type MessagesFromContextOptions,
} from "./transform/messages-from-context.js";
import { newSessionId } from "./ids.js";
import {
  isNonMessageSessionItem,
  type CompactionItem,
  type CompactionKind,
  type CheckpointCreatedItem,
  type RoutingItem,
  type SessionContext,
  type SessionItem,
  type SessionMessage,
  type ToolOutcomeItem,
  type ToolResultSummary,
} from "./types.js";
import type { SaveSessionOptions } from "./transform.js";

function buildSessionMessage(
  sessionId: string,
  turn: number,
  role: SessionMessage["role"],
  content: SessionMessage["content"],
  at = new Date().toISOString(),
): SessionMessage {
  return {
    id: newEventId(),
    sessionId,
    turn,
    at,
    role,
    content,
  };
}

function emptyContext(): SessionContext {
  return { messages: [] };
}

export class Session {
  private messages: SessionMessage[];

  constructor(
    readonly sessionId: string,
    private readonly reader: FileSessionItemReader,
    context: SessionContext = emptyContext(),
  ) {
    this.messages = [...context.messages];
  }

  static create(workdir = getWorkdir()): Session {
    return new Session(newSessionId(), new FileSessionItemReader(workdir));
  }

  static open(sessionId: string, workdir = getWorkdir()): Session {
    const reader = new FileSessionItemReader(workdir);
    const items = parseItems(readLines(sessionLogPath(workdir, sessionId)));
    return new Session(sessionId, reader, {
      messages: messagesFromItems(items),
    });
  }

  getContext(): SessionContext {
    return { messages: [...this.messages] };
  }

  getMessages(): readonly SessionMessage[] {
    return [...this.messages];
  }

  toMessages(options?: MessagesFromContextOptions): Message[] {
    return messagesFromContext(this.getContext(), options);
  }

  async readItems(): Promise<SessionItem[]> {
    return this.reader.readAll(this.sessionId);
  }

  async flush(): Promise<void> {
    // append is synchronous; reserved for buffered writers
  }

  async appendUser(turn: number, text: string): Promise<void> {
    const message = buildSessionMessage(this.sessionId, turn, "user", text);
    await this.pushMessage(message);
  }

  async appendAssistant(turn: number, blocks: ContentBlock[]): Promise<void> {
    const message = buildSessionMessage(this.sessionId, turn, "assistant", blocks);
    await this.pushMessage(message);
  }

  async appendToolInvocation(
    turn: number,
    toolUseId: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    await this.appendAssistant(turn, [
      { type: "tool_use", id: toolUseId, name, input },
    ]);
  }

  async appendToolOutcome(
    turn: number,
    toolUseId: string,
    resultSummary: ToolResultSummary,
    artifactId?: string,
  ): Promise<void> {
    const at = new Date().toISOString();
    const item: ToolOutcomeItem = {
      kind: "tool_outcome",
      id: newEventId(),
      sessionId: this.sessionId,
      turn,
      at,
      toolUseId,
      artifactId,
      resultSummary,
    };
    await this.pushItem(item);
    this.mergeToolResultInMemory(
      turn,
      toolUseId,
      formatToolSummary(resultSummary, artifactId),
      at,
    );
  }

  private mergeToolResultInMemory(
    turn: number,
    toolUseId: string,
    content: string,
    at: string,
  ): void {
    const block = { type: "tool_result" as const, tool_use_id: toolUseId, content };
    const last = this.messages.at(-1);
    if (
      last?.role === "user"
      && Array.isArray(last.content)
      && last.content.every((entry) => entry.type === "tool_result")
      && last.turn === turn
    ) {
      last.content.push(block);
      return;
    }

    this.messages.push(
      buildSessionMessage(this.sessionId, turn, "user", [block], at),
    );
  }

  truncateMessages(lastItemId: string): void {
    const index = this.messages.findIndex((message) => message.id === lastItemId);
    if (index === -1) {
      return;
    }
    this.messages = this.messages.slice(0, index + 1);
  }

  async appendCompactionItem(
    turn: number,
    beforeTokens: number,
    afterTokens: number,
    compactionKind: CompactionKind = "prune",
    compactionRecordId?: string,
  ): Promise<void> {
    const item: CompactionItem = {
      kind: "compaction",
      id: newEventId(),
      sessionId: this.sessionId,
      turn,
      at: new Date().toISOString(),
      compactionKind,
      compactionRecordId,
      excludedLogIds: [],
      beforeTokens,
      afterTokens,
    };
    await this.pushItem(item);
  }

  async appendCheckpointItem(turn: number, checkpointId: string): Promise<void> {
    const item: CheckpointCreatedItem = {
      kind: "checkpoint_created",
      id: newEventId(),
      sessionId: this.sessionId,
      turn,
      at: new Date().toISOString(),
      checkpointId,
    };
    await this.pushItem(item);
  }

  async appendRoutingItem(turn: number, decision: RoutingDecision): Promise<void> {
    const item: RoutingItem = {
      kind: "routing",
      id: newEventId(),
      sessionId: this.sessionId,
      turn,
      at: new Date().toISOString(),
      decision,
    };
    await this.pushItem(item);
  }

  async importItems(items: SessionItem[], options?: SaveSessionOptions): Promise<void> {
    const mode = options?.mode ?? "append-new";
    if (mode === "replace") {
      this.messages = messagesFromItems(items);
      await replaceSessionItems(this.sessionId, items);
      return;
    }

    const existingIds = new Set<string>();
    if (mode === "append-new") {
      for (const message of this.messages) {
        existingIds.add(message.id);
      }
    }

    for (const item of items) {
      if (mode === "append-new" && existingIds.has(item.id)) {
        continue;
      }
      if (isNonMessageSessionItem(item) || item.kind === "tool_invocation") {
        await this.pushItem(item);
        continue;
      }

      const hydrated = messagesFromItems([item]);
      const message = hydrated[0];
      if (!message) {
        continue;
      }
      if (mode === "append-new" && existingIds.has(message.id)) {
        continue;
      }
      await this.pushMessage(message);
    }
  }

  private async pushMessage(message: SessionMessage): Promise<void> {
    this.messages.push(message);
    await this.commitItems(itemsFromMessage(message));
  }

  private async pushItem(item: SessionItem): Promise<void> {
    await hookDispatcher.dispatch("sessionItem", { item });
  }

  private async commitItems(items: SessionItem[]): Promise<void> {
    for (const item of items) {
      await hookDispatcher.dispatch("sessionItem", { item });
    }
  }
}
