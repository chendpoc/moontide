import { describe, expect, it } from "vitest";
import type { StreamAssistantEvent, StreamFn } from "@moontide/run-protocol";
import { createMessageLog, createRunEventBus, runLoop } from "@moontide/agent-core";
import { identityRunConfig, noopToolExecutor } from "../packages/agent-core/src/testing/index.js";
import { createReplRunEventProjection } from "../packages/agent-cli/src/cli/repl/run-event-projection.js";
import type { ReplTerminal } from "../packages/agent-cli/src/cli/repl/terminal.js";

function createCollectingTerminal(): ReplTerminal & { combined: () => string } {
  const chunks: string[] = [];
  return {
    prepareAssistantBlock: () => {},
    onAssistantDelta: (text: string) => {
      chunks.push(text);
    },
    onAssistantEnd: (text: string) => {
      if (text.length > 0) {
        chunks.push(text);
      }
      chunks.push("\n");
    },
    onAssistantMismatch: (text: string) => {
      chunks.push("\n");
      if (text.length > 0) {
        chunks.push(text);
      }
      chunks.push("\n");
    },
    combined: () => chunks.join(""),
  } as unknown as ReplTerminal & { combined: () => string };
}

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

    const terminal = createCollectingTerminal();
    const projection = createReplRunEventProjection(terminal);
    const eventBus = createRunEventBus();
    eventBus.subscribe(projection.listener);

    const result = await runLoop({
      eventBus,
      log: createMessageLog(),
      config: identityRunConfig(),
      streamFn,
      toolExecutor: noopToolExecutor("ok"),
      llmDefaults: {},
      prompts: [{ role: "user", content: "昨日 X 热点 Top 10", timestamp: 1 }],
    });

    expect(terminal.combined()).toContain("Sophie");
    expect(result.reply).toContain("Sophie");
    expect(result.reply).toContain("说明");
    expect(projection.hadOutput()).toBe(true);
  });
});
