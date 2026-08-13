import type readline from "node:readline/promises";

import {
  setActivityRepaintEnabled,
} from "../statusline/activity.js";
import {
  resumeStatusStack,
  suspendStatusStack,
} from "../statusline/render-stack.js";
import { renderStatusStackAsync } from "../statusline/render.js";
import { writeStderr, writeStderrBlock, writeStderrLine } from "../../terminal/write.js";
import { formatTurnSeparatorLine, formatUserLine } from "./transcript.js";

export class ReplTerminal {
  private assistantStreaming = false;

  constructor(private readonly rl: readline.Interface) {}

  async beforePrompt(): Promise<void> {
    suspendStatusStack();
    setActivityRepaintEnabled(false);
  }

  async question(prompt: string): Promise<string> {
    await this.beforePrompt();
    try {
      return await this.rl.question(prompt);
    } finally {
      await this.afterPrompt();
    }
  }

  async afterPrompt(): Promise<void> {
    setActivityRepaintEnabled(true);
    await resumeStatusStack();
  }

  appendTurnSeparator(): void {
    suspendStatusStack();
    writeStderrLine(formatTurnSeparatorLine());
  }

  appendUser(text: string): void {
    suspendStatusStack();
    writeStderrLine(formatUserLine(text));
  }

  prepareAssistantBlock(): void {
    this.assistantStreaming = false;
  }

  onAssistantDelta(text: string): void {
    if (!this.assistantStreaming) {
      suspendStatusStack();
      this.assistantStreaming = true;
    }
    if (text.length > 0) {
      writeStderr(text);
    }
  }

  onAssistantEnd(text: string): void {
    if (!this.assistantStreaming) {
      suspendStatusStack();
    }
    if (text.length > 0) {
      writeStderr(text);
    }
    writeStderr("\n");
    this.assistantStreaming = false;
    void resumeStatusStack();
  }

  /** Provider final text diverges from streamed prefix — append full text on new lines. */
  onAssistantMismatch(finalText: string): void {
    if (!this.assistantStreaming) {
      suspendStatusStack();
    }
    writeStderr("\n");
    if (finalText.length > 0) {
      writeStderr(finalText);
    }
    writeStderr("\n");
    this.assistantStreaming = false;
    void resumeStatusStack();
  }

  appendAssistantFallback(reply: string): void {
    if (reply.length === 0) {
      return;
    }
    suspendStatusStack();
    writeStderrLine(reply);
    this.assistantStreaming = false;
    void resumeStatusStack();
  }

  writeErrorBlock(text: string): void {
    writeStderrBlock(text);
  }

  async flush(): Promise<void> {
    await renderStatusStackAsync();
  }

  resetTranscriptState(): void {
    this.assistantStreaming = false;
  }

  isAssistantStreaming(): boolean {
    return this.assistantStreaming;
  }
}
