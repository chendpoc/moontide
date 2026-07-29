import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSinks } from "../src/events/bus.js";
import { refreshEventSinks, resetEventPlatform } from "../src/events/setup.js";
import { JsonlSink } from "../src/events/sinks/jsonl.js";

describe("event sink setup", () => {
  beforeEach(() => {
    resetEventPlatform();
  });

  afterEach(() => {
    resetEventPlatform();
  });

  it("registers JsonlSink only", () => {
    refreshEventSinks();
    const types = getSinks().map((sink) => sink.constructor);
    expect(types).toEqual([JsonlSink]);
  });
});
