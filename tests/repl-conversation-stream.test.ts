import { describe, expect, it, vi } from "vitest";

import { createRunEventBus } from "@moontide/agent-core";
import { createReplConversationStreamListener } from "../apps/moontide/src/log/repl-conversation-stream.js";

describe("repl conversation stream", () => {
  it("flushes assistant text on message_end before tool execution continues", () => {
    const onText = vi.fn();
    const stream = createReplConversationStreamListener({ onText });
    const eventBus = createRunEventBus();
    eventBus.subscribe(stream.listener);

    eventBus.publish({
      type: "message_end",
      message: {
        role: "assistant",
        timestamp: 1,
        content: [
          { type: "text", text: "| 1 | Sophie |" },
          { type: "toolCall", toolCallId: "call-1", toolName: "work_mem", args: {} },
        ],
      },
    });

    expect(onText).toHaveBeenCalledWith("| 1 | Sophie |");
    expect(stream.hadOutput()).toBe(true);
  });

  it("ignores non-assistant message_end events", () => {
    const onText = vi.fn();
    const stream = createReplConversationStreamListener({ onText });
    const eventBus = createRunEventBus();
    eventBus.subscribe(stream.listener);

    eventBus.publish({
      type: "message_end",
      message: { role: "user", content: "hi", timestamp: 1 },
    });

    expect(onText).not.toHaveBeenCalled();
    expect(stream.hadOutput()).toBe(false);
  });
});
