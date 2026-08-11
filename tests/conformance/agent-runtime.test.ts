import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createAgentRuntime,
  getAgentRuntime,
  setAgentRuntime,
} from "../../packages/agent/src/agent/runtime/index.js";
import { getToolDefinitions } from "../../packages/agent/src/tools/index.js";

describe("AgentRuntime", () => {
  beforeEach(() => {
    setAgentRuntime(createAgentRuntime());
  });

  afterEach(() => {
    setAgentRuntime(undefined);
  });

  it("isolates observer registrations per runtime instance", async () => {
    const runtimeA = getAgentRuntime();
    const seen: string[] = [];
    runtimeA.observerRegistry.sidecar().on("runStart", "probe", () => {
      seen.push("a");
    });

    const runtimeB = createAgentRuntime();
    setAgentRuntime(runtimeB);
    runtimeB.observerRegistry.sidecar().on("runStart", "probe", () => {
      seen.push("b");
    });

    await runtimeB.observers.dispatch("runStart", { userPrompt: "hi" });
    expect(seen).toEqual(["b"]);

    const runtimeC = createAgentRuntime();
    setAgentRuntime(runtimeC);
    await runtimeC.observers.dispatch("runStart", { userPrompt: "again" });
    expect(seen).toEqual(["b"]);
  });

  it("reset clears observers, tools, and plugins", () => {
    const runtime = getAgentRuntime();
    runtime.observerRegistry.sidecar().on("runStart", "temp", () => undefined);
    expect(runtime.observerRegistry.getRegistrations("runStart")).toHaveLength(1);

    runtime.reset();
    expect(runtime.observerRegistry.getRegistrations("runStart")).toHaveLength(0);
    expect(getToolDefinitions(runtime.tools).some((tool) => tool.name === "read_file")).toBe(true);
    expect(runtime.plugins.listAttached()).toEqual([]);
  });
});
