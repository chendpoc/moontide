import { describe, expect, it } from "vitest";

import { enrichEvent } from "../src/events/enrich.js";
import type { AgentEvent } from "../src/events/types.js";

function baseEvent(partial: Partial<AgentEvent>): AgentEvent {
  return {
    id: "id",
    seq: 1,
    runId: "run",
    turn: 1,
    phase: "pre_llm",
    channel: "context",
    kind: "metrics_pre",
    ts: Date.now(),
    payload: {},
    ...partial,
  };
}

describe("enrichEvent", () => {
  it("adds summary and displayHint without removing core fields", () => {
    const event = baseEvent({
      channel: "trace",
      kind: "thinking",
      preview: "plan ahead",
      payload: { body: "plan ahead" },
    });
    const enriched = enrichEvent(event);

    expect(enriched.id).toBe(event.id);
    expect(enriched.seq).toBe(event.seq);
    expect(enriched.displayHint).toBe("trace");
    expect(enriched.summary).toBe("trace/thinking plan ahead");
  });

  it("builds audit summary from tool name", () => {
    const enriched = enrichEvent(
      baseEvent({
        channel: "audit",
        kind: "tool_use",
        phase: "post_tool",
        preview: "Bash",
        payload: { toolName: "Bash", toolInput: { command: "ls" } },
      }),
    );
    expect(enriched.summary).toBe("audit/tool_use Bash");
    expect(enriched.displayHint).toBe("audit");
  });

  it("serializes as valid compact JSON", () => {
    const enriched = enrichEvent(
      baseEvent({ preview: "est 100/128000", payload: { report: {} } }),
    );
    const line = JSON.stringify(enriched);
    expect(() => JSON.parse(line)).not.toThrow();
    expect(JSON.parse(line).summary).toContain("context/metrics_pre");
  });
});
