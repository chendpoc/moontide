import { describe, expect, it } from "vitest";
import type { StreamAssistantEvent, StreamFn } from "@moontide/agent-common";
import { createMessageLog, createRunEventBus, runLoop } from "@moontide/agent-core";
import { identityRunConfig, noopToolExecutor } from "../packages/agent-core/src/testing/index.js";
import { createReplConversationStreamListener } from "../apps/moontide/src/log/repl-conversation-stream.js";

/** Mirrors session 20260810-194303-6650a144 turn 24→25: table+work_mem then follow-up text. */
describe("REPL stream + runLoop integration", () => {
  it("streams table before tools and keeps full reply", async () => {
    let call = 0;
    const streamFn: StreamFn = async function* (): AsyncIterable<StreamAssistantEvent> {
      call += 1;
      if (call === 1) {
        yield {
          type: "done",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "以下是热点 Top 10：\n\n| 1 | Sophie |\n| 2 | Drake |",
              },
              {
                type: "toolCall",
                toolCallId: "call-1",
                toolName: "work_mem",
                args: { action: "draft", kind: "decision" },
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
          content: [{ type: "text", text: "**说明：** 第三方归档站。" }],
          timestamp: Date.now(),
        },
      };
    };

    const flushed: string[] = [];
    const stream = createReplConversationStreamListener({
      onText: (text) => flushed.push(text),
    });
    const eventBus = createRunEventBus();
    eventBus.subscribe(stream.listener);

    const result = await runLoop({
      eventBus,
      log: createMessageLog(),
      config: identityRunConfig(),
      streamFn,
      toolExecutor: noopToolExecutor("ok"),
      llmDefaults: {},
      prompts: [{ role: "user", content: "昨日 X 热点 Top 10", timestamp: 1 }],
    });

    expect(flushed.some((t) => t.includes("Sophie"))).toBe(true);
    expect(result.reply).toContain("Sophie");
    expect(result.reply).toContain("说明");
    expect(stream.hadOutput()).toBe(true);
  });
});
