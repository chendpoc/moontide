import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getOutputs } from "../src/events/bus.js";
import { refreshEventOutputs, resetEventPlatform } from "../src/events/setup.js";
import { JsonlWriter } from "../src/events/outputs/jsonl.js";
import { StderrRenderer } from "../src/events/outputs/stderr-renderer.js";

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
