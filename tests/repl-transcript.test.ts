import { afterEach, describe, expect, it, vi } from "vitest";

import { stripAnsi } from "@moontide/shared/utils/text.js";

import { createRunEventBus } from "@moontide/agent-core";
import { createReplRunEventProjection } from "../packages/agent-cli/src/cli/repl/run-event-projection.js";
import type { ReplTerminal } from "../packages/agent-cli/src/cli/repl/terminal.js";

function createMockTerminal(): ReplTerminal & {
  calls: Array<{ method: string; arg?: string }>;
  stderr: string[];
} {
  const calls: Array<{ method: string; arg?: string }> = [];
  const stderr: string[] = [];
  const terminal = {
    calls,
    stderr,
    prepareAssistantBlock: () => {
      calls.push({ method: "prepareAssistantBlock" });
    },
    onAssistantDelta: (text: string) => {
      calls.push({ method: "onAssistantDelta", arg: text });
      stderr.push(text);
    },
    onAssistantEnd: (text: string) => {
      calls.push({ method: "onAssistantEnd", arg: text });
      if (text.length > 0) {
        stderr.push(text);
      }
      stderr.push("\n");
    },
    onAssistantMismatch: (text: string) => {
      calls.push({ method: "onAssistantMismatch", arg: text });
      stderr.push("\n");
      if (text.length > 0) {
        stderr.push(text);
      }
      stderr.push("\n");
    },
  } as unknown as ReplTerminal & {
    calls: Array<{ method: string; arg?: string }>;
    stderr: string[];
  };
  return terminal;
}

describe("repl run event projection", () => {
  it("streams text_delta then reconciles suffix on message_end", () => {
    const terminal = createMockTerminal();
    const projection = createReplRunEventProjection(terminal);
    const eventBus = createRunEventBus();
    eventBus.subscribe(projection.listener);

    eventBus.publish({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 1 },
    });
    eventBus.publish({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "hel" }], timestamp: 1 },
      delta: { kind: "text_delta", text: "hel" },
    });
    eventBus.publish({
      type: "message_end",
      message: {
        role: "assistant",
        timestamp: 1,
        content: [{ type: "text", text: "hello" }],
      },
    });

    expect(terminal.stderr.join("")).toBe("hello\n");
    expect(projection.hadOutput()).toBe(true);
  });

  it("writes full text on final-message-only path", () => {
    const terminal = createMockTerminal();
    const projection = createReplRunEventProjection(terminal);
    const eventBus = createRunEventBus();
    eventBus.subscribe(projection.listener);

    eventBus.publish({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 1 },
    });
    eventBus.publish({
      type: "message_end",
      message: {
        role: "assistant",
        timestamp: 1,
        content: [{ type: "text", text: "| 1 | Sophie |" }],
      },
    });

    expect(terminal.stderr.join("")).toBe("| 1 | Sophie |\n");
    expect(projection.hadOutput()).toBe(true);
  });

  it("handles streamed prefix mismatch with onAssistantMismatch", () => {
    const terminal = createMockTerminal();
    const projection = createReplRunEventProjection(terminal);
    const eventBus = createRunEventBus();
    eventBus.subscribe(projection.listener);

    eventBus.publish({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 1 },
    });
    eventBus.publish({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "wrong" }], timestamp: 1 },
      delta: { kind: "text_delta", text: "wrong" },
    });
    eventBus.publish({
      type: "message_end",
      message: {
        role: "assistant",
        timestamp: 1,
        content: [{ type: "text", text: "correct" }],
      },
    });

    expect(terminal.calls.some((c) => c.method === "onAssistantMismatch")).toBe(true);
    expect(projection.hadOutput()).toBe(true);
  });
});

describe("repl transcript format", () => {
  it("formats user lines with prefix", async () => {
    const { formatUserLine } = await import("../packages/agent-cli/src/cli/repl/transcript.js");
    expect(formatUserLine("1+1=?")).toContain("1+1=?");
  });
});

describe("ReplTerminal final-only with activity stack", () => {
  afterEach(async () => {
    const { resetStatusLineRender, endAgentActivity } = await import(
      "../packages/agent-cli/src/cli/statusline/render.js"
    );
    endAgentActivity();
    resetStatusLineRender();
  });

  it("keeps assistant text when activity stack shrinks after final-message-only reply", async () => {
    const writes: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    const originalIsTTY = process.stderr.isTTY;

    process.stderr.write = ((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    try {
      const { ReplTerminal } = await import("../packages/agent-cli/src/cli/repl/terminal.js");
      const { beginAgentActivity, endAgentActivity } = await import(
        "../packages/agent-cli/src/cli/statusline/render.js"
      );

      const terminal = new ReplTerminal({ question: vi.fn() } as never);
      terminal.appendUser("hi");
      beginAgentActivity();
      terminal.onAssistantEnd("Hi.");
      await terminal.flush();
      endAgentActivity();
      await terminal.flush();

      expect(stripAnsi(writes.join(""))).toContain("Hi.");
    } finally {
      process.stderr.write = originalWrite;
      Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });
});

describe("ReplTerminal appendUser", () => {
  it("writes formatted user line to stderr", async () => {
    const writes: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const { ReplTerminal } = await import("../packages/agent-cli/src/cli/repl/terminal.js");
      const rl = { question: vi.fn() } as never;
      const terminal = new ReplTerminal(rl);
      terminal.appendUser("hello");
      expect(writes.join("")).toContain("hello");
    } finally {
      process.stderr.write = original;
    }
  });
});
