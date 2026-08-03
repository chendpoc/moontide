import { getWorkdir } from "../config.js";
import type { ContentBlock } from "../llm/protocol/types.js";
import type {
  CompactionKind,
  SessionLog,
  SessionLogBody,
  ToolResultSummary,
} from "./log-types.js";
import { newSessionId } from "./ids.js";
import {
  buildSessionLog,
  FileSessionLogReader,
  FileSessionLogWriter,
} from "./log.js";

export class Session {
  readonly sessionId: string;

  constructor(
    sessionId: string,
    private readonly writer: FileSessionLogWriter,
    private readonly reader: FileSessionLogReader,
  ) {
    this.sessionId = sessionId;
  }

  static create(workdir = getWorkdir()): Session {
    return new Session(
      newSessionId(),
      new FileSessionLogWriter(workdir),
      new FileSessionLogReader(workdir),
    );
  }

  static open(sessionId: string, workdir = getWorkdir()): Session {
    return new Session(
      sessionId,
      new FileSessionLogWriter(workdir),
      new FileSessionLogReader(workdir),
    );
  }

  async appendUser(turn: number, text: string): Promise<void> {
    await this.appendBody(turn, { kind: "user_message", text });
  }

  async appendAssistant(turn: number, blocks: ContentBlock[]): Promise<void> {
    await this.appendBody(turn, { kind: "assistant_message", blocks });
  }

  async appendToolInvocation(
    turn: number,
    toolUseId: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    await this.appendBody(turn, {
      kind: "tool_invocation",
      toolUseId,
      name,
      input,
    });
  }

  async appendToolOutcome(
    turn: number,
    toolUseId: string,
    resultSummary: ToolResultSummary,
  ): Promise<void> {
    await this.appendBody(turn, {
      kind: "tool_outcome",
      toolUseId,
      resultSummary,
    });
  }

  async appendCompaction(
    turn: number,
    beforeTokens: number,
    afterTokens: number,
    compactionKind: CompactionKind = "prune",
  ): Promise<void> {
    await this.appendBody(turn, {
      kind: "compaction",
      compactionKind,
      excludedLogIds: [],
      beforeTokens,
      afterTokens,
    });
  }

  async readLog(): Promise<SessionLog[]> {
    return this.reader.readAll(this.sessionId);
  }

  async flush(): Promise<void> {
    // appendNdjsonLine is synchronous; reserved for future buffered writers
  }

  private async appendBody(turn: number, body: SessionLogBody): Promise<void> {
    const record = buildSessionLog(this.sessionId, turn, body);
    await this.writer.append(this.sessionId, record);
  }
}
