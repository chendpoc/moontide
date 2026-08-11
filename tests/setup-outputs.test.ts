import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyAgentEventPipeline, resetEventPlatform } from "@moontide/agent";
import { getOutputs } from "@moontide/log";
import { createCliEventPipeline } from "../packages/agent-cli/src/log/cli-event-pipeline.js";
import { JsonlWriter } from "@moontide/log";
import { StderrRenderer } from "../packages/agent-cli/src/log/outputs/stderr-renderer.js";

describe("event output setup", () => {
  beforeEach(() => {
    resetEventPlatform();
  });

  afterEach(() => {
    resetEventPlatform();
  });

  it("registers JsonlWriter and StderrRenderer via createCliEventPipeline", () => {
    applyAgentEventPipeline(createCliEventPipeline("/tmp/moontide-output-test"));
    const types = getOutputs().map((output) => output.constructor);
    expect(types).toEqual([JsonlWriter, StderrRenderer]);
  });
});
