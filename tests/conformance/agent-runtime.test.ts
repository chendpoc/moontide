import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createAgentRuntime,
  getAgentRuntime,
  setAgentRuntime,
} from "../../apps/moontide/src/agent/runtime/index.js";
import { getToolDefinitions } from "../../apps/moontide/src/tools/index.js";

describe("AgentRuntime", () => {
  beforeEach(() => {
    setAgentRuntime(createAgentRuntime());
  });

  afterEach(() => {
    setAgentRuntime(undefined);
  });

  it("isolates hook registrations per runtime instance", async () => {
    const runtimeA = getAgentRuntime();
    const seen: string[] = [];
    runtimeA.hookRegistry.sidecar().on("runStart", "probe", () => {
      seen.push("a");
    });

    const runtimeB = createAgentRuntime();
    setAgentRuntime(runtimeB);
    runtimeB.hookRegistry.sidecar().on("runStart", "probe", () => {
      seen.push("b");
    });

    await runtimeB.hooks.dispatch("runStart", { userPrompt: "hi" });
    expect(seen).toEqual(["b"]);

    const runtimeC = createAgentRuntime();
    setAgentRuntime(runtimeC);
    await runtimeC.hooks.dispatch("runStart", { userPrompt: "again" });
    expect(seen).toEqual(["b"]);
  });

  it("reset clears hooks, tools, and plugins", () => {
    const runtime = getAgentRuntime();
    runtime.hookRegistry.sidecar().on("runStart", "temp", () => undefined);
    expect(runtime.hookRegistry.getRegistrations("runStart")).toHaveLength(1);

    runtime.reset();
    expect(runtime.hookRegistry.getRegistrations("runStart")).toHaveLength(0);
    expect(getToolDefinitions(runtime.tools).some((tool) => tool.name === "read_file")).toBe(true);
    expect(runtime.plugins.listAttached()).toEqual([]);
  });
});
