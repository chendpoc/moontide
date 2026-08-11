import { describe, expect, it } from "vitest";
import type { StreamAssistantEvent, StreamFn } from "@moontide/run-protocol";
import { createMessageLog } from "../src/message-log.js";
import { createRunEventBus } from "../src/run-event-bus.js";
import { runLoop } from "../src/loop.js";
import {
  identityRunConfig,
  mockTextStreamFn,
  mockToolThenTextStream,
  noopToolExecutor,
} from "../src/testing/index.js";

describe("runLoop golden sequences", () => {
  it("prompt with text-only assistant", async () => {
    const eventBus = createRunEventBus();
    const log = createMessageLog();

    const result = await runLoop({
      eventBus,
      log,
      config: identityRunConfig(),
      streamFn: mockTextStreamFn("hello"),
      toolExecutor: noopToolExecutor(),
      llmDefaults: {},
      prompts: [{ role: "user", content: "hi", timestamp: 1 }],
    });

    expect(result.reply).toBe("hello");
    expect(result.turns).toBe(1);
    expect(eventBus.events.map((e) => e.type)).toEqual([
      "run_start",
      "message_start",
      "message_end",
      "turn_start",
      "message_start",
      "message_update",
      "message_end",
      "turn_end",
      "run_end",
    ]);
  });

  it("keeps co-emitted answer text when assistant also calls tools", async () => {
    let call = 0;
    const streamFn: StreamFn = async function* (): AsyncIterable<StreamAssistantEvent> {
      call += 1;
      if (call === 1) {
        yield {
          type: "done",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "| 排名 | 话题 |\n| 1 | Sophie |" },
              {
                type: "toolCall",
                toolCallId: "call-1",
                toolName: "work_mem",
                args: { action: "note", content: "hot topics" },
              },
            ],
            timestamp: Date.now(),
          },
        };
        return;
      }
      yield {
        type: "done",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          timestamp: Date.now(),
        },
      };
    };

    const eventBus = createRunEventBus();
    const log = createMessageLog();

    const result = await runLoop({
      eventBus,
      log,
      config: identityRunConfig(),
      streamFn,
      toolExecutor: noopToolExecutor("ok"),
      llmDefaults: {},
      prompts: [{ role: "user", content: "top trends", timestamp: 1 }],
    });

    expect(result.reply).toContain("Sophie");
    expect(result.turns).toBe(2);
  });

  it("keeps table answer when a follow-up text turn runs after text+tool", async () => {
    let call = 0;
    const streamFn: StreamFn = async function* (): AsyncIterable<StreamAssistantEvent> {
      call += 1;
      if (call === 1) {
        yield {
          type: "done",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "| 1 | Sophie |" },
              {
                type: "toolCall",
                toolCallId: "call-1",
                toolName: "work_mem",
                args: { action: "note" },
              },
            ],
            timestamp: Date.now(),
          },
        };
        return;
      }
      yield {
        type: "done",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "extra note" }],
          timestamp: Date.now(),
        },
      };
    };

    const eventBus = createRunEventBus();
    const log = createMessageLog();
    const result = await runLoop({
      eventBus,
      log,
      config: identityRunConfig(),
      streamFn,
      toolExecutor: noopToolExecutor("ok"),
      llmDefaults: {},
      prompts: [{ role: "user", content: "top trends", timestamp: 1 }],
    });

    expect(result.reply).toContain("Sophie");
    expect(result.reply).toContain("extra note");
    expect(result.turns).toBe(2);
  });

  it("runs tool turn then follow-up assistant turn", async () => {
    const eventBus = createRunEventBus();
    const log = createMessageLog();

    const result = await runLoop({
      eventBus,
      log,
      config: identityRunConfig(),
      streamFn: mockToolThenTextStream("read_file", { path: "a.txt" }, "done"),
      toolExecutor: noopToolExecutor("file contents"),
      llmDefaults: {},
      prompts: [{ role: "user", content: "read", timestamp: 1 }],
    });

    expect(result.reply).toBe("done");
    expect(result.turns).toBe(2);
    const types = eventBus.events.map((e) => e.type);
    expect(types).toContain("tool_execution_start");
    expect(types).toContain("tool_execution_end");
    expect(types.filter((t) => t === "turn_start")).toHaveLength(2);
  });
});

describe("Agent", () => {
  it("prompt resolves with reply", async () => {
    const { Agent } = await import("../src/agent.js");
    const agent = new Agent({
      config: identityRunConfig(),
      streamFn: mockTextStreamFn("world"),
      toolExecutor: noopToolExecutor(),
    });
    const result = await agent.prompt("hello");
    expect(result.reply).toBe("world");
  });
});
