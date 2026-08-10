import { describe, expect, it } from "vitest";

import type { AssistantMessage } from "@moontide/agent-common";
import { createMessageLog } from "../packages/agent-core/src/message-log.js";
import { createRunEventBus } from "../packages/agent-core/src/run-event-bus.js";
import { executeToolCalls } from "../packages/agent-core/src/run-tools.js";
import { noopToolExecutor } from "../packages/agent-core/src/testing/index.js";

describe("malformed_tool_arguments harness gate", () => {
  it("does not publish tool_execution_start for malformed tool calls", async () => {
    const eventBus = createRunEventBus();
    const log = createMessageLog();
    const assistant: AssistantMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          toolCallId: "call_bad",
          toolName: "grep",
          args: {},
          argumentStatus: "malformed_tool_arguments",
          rawArguments: "{bad",
        },
      ],
    };

    const results = await executeToolCalls(
      eventBus,
      log,
      {},
      assistant,
      noopToolExecutor("should-not-run"),
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.isError).toBe(true);
    expect(results[0]?.content).toContain("malformed tool arguments");
    expect(eventBus.events.some((event) => event.type === "tool_execution_start")).toBe(false);
  });
});
