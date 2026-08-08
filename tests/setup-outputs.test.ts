import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getOutputs } from "../apps/moontide/src/log/index.js";
import { refreshEventOutputs, resetEventPlatform } from "../apps/moontide/src/log/setup.js";
import { JsonlWriter } from "@moontide/log";
import { StderrRenderer } from "../apps/moontide/src/log/outputs/stderr-renderer.js";

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
