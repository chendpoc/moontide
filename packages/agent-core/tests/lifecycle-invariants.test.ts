import { describe, expect, it } from "vitest";
import type { RunConfig } from "@moontide/agent-common";
import { createMessageLog } from "../src/message-log.js";
import { createRunEventBus } from "../src/run-event-bus.js";
import { withRun } from "../src/lifecycle.js";

describe("withRun lifecycle", () => {
  it("emits run_start then run_end on success", async () => {
    const eventBus = createRunEventBus();
    const log = createMessageLog();

    await withRun({ eventBus, log }, async () => "ok");

    expect(eventBus.events.map((e) => e.type)).toEqual(["run_start", "run_end"]);
    expect(eventBus.events[1]?.type === "run_end" && eventBus.events[1].outcome.kind).toBe("success");
  });

  it("emits run_end with error outcome when fn throws", async () => {
    const eventBus = createRunEventBus();
    const log = createMessageLog();

    await expect(
      withRun({ eventBus, log }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(eventBus.events.at(-1)?.type).toBe("run_end");
    const end = eventBus.events.at(-1);
    expect(end?.type === "run_end" && end.outcome.kind).toBe("error");
  });
});

describe("resolveRunConfig freeze", () => {
  it("returns frozen config object", async () => {
    const { resolveRunConfig } = await import("../src/resolve-run-config.js");
    const base: RunConfig = {
      convertToLlm: (m) => m.map((msg) => ({ role: "user" as const, content: msg.role })),
    };
    const frozen = resolveRunConfig(base);
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});
