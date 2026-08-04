import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getOutputs } from "../src/log/bus.js";
import { refreshEventOutputs, resetEventPlatform } from "../src/log/setup.js";
import { JsonlWriter } from "../src/log/outputs/jsonl.js";
import { StderrRenderer } from "../src/log/outputs/stderr-renderer.js";

describe("event output setup", () => {
  beforeEach(() => {
    resetEventPlatform();
  });

  afterEach(() => {
    resetEventPlatform();
  });

  it("registers JsonlWriter and StderrRenderer", () => {
    refreshEventOutputs();
    const types = getOutputs().map((output) => output.constructor);
    expect(types).toEqual([JsonlWriter, StderrRenderer]);
  });
});
