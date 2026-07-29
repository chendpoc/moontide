import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSinks } from "../src/events/bus.js";
import { setCliEventsArgv, setEventsOverride } from "../src/cli/display-session.js";
import { refreshEventSinks, resetEventPlatform } from "../src/events/setup.js";
import { CliSink } from "../src/events/sinks/cli.js";
import { JsonlSink } from "../src/events/sinks/jsonl.js";
import { NdjsonStdoutSink } from "../src/events/sinks/ndjson.js";

describe("event sink setup", () => {
  beforeEach(() => {
    resetEventPlatform();
    setCliEventsArgv(false);
    setEventsOverride(null);
  });

  afterEach(() => {
    resetEventPlatform();
    setCliEventsArgv(false);
    setEventsOverride(null);
  });

  it("always includes CliSink and JsonlSink", () => {
    refreshEventSinks();
    const types = getSinks().map((sink) => sink.constructor);
    expect(types).toContain(JsonlSink);
    expect(types).toContain(CliSink);
    expect(types.filter((t) => t === CliSink)).toHaveLength(1);
  });

  it("adds NdjsonStdoutSink when events mode is on without removing CliSink", () => {
    setEventsOverride(true);
    refreshEventSinks();
    const types = getSinks().map((sink) => sink.constructor);
    expect(types).toContain(CliSink);
    expect(types).toContain(NdjsonStdoutSink);
    expect(types.filter((t) => t === CliSink)).toHaveLength(1);
  });

  it("removes NdjsonStdoutSink when events mode is off", () => {
    setEventsOverride(true);
    refreshEventSinks();
    setEventsOverride(false);
    refreshEventSinks();
    const types = getSinks().map((sink) => sink.constructor);
    expect(types).toContain(CliSink);
    expect(types).not.toContain(NdjsonStdoutSink);
  });
});
