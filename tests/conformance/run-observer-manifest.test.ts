import { describe, expect, it } from "vitest";

import { buildDefaultObserverManifest } from "../../packages/agent/src/agent/run-observers/manifest.js";
import { PHASE_DEFS, type ObserverErrorPolicy } from "../../packages/agent/src/agent/run-observers/phases.js";

const VALID_ERROR_POLICIES = new Set<ObserverErrorPolicy>(["fail-open", "fail-closed"]);

describe("default run observer manifest conformance", () => {
  it("registers only known phases with unique names per phase", () => {
    const seen = new Map<string, Set<string>>();

    for (const spec of buildDefaultObserverManifest()) {
      expect(PHASE_DEFS[spec.phase], `unknown phase: ${spec.phase}`).toBeDefined();
      expect(typeof spec.register).toBe("function");

      if (spec.errorPolicy) {
        expect(VALID_ERROR_POLICIES.has(spec.errorPolicy)).toBe(true);
      }

      const names = seen.get(spec.phase) ?? new Set<string>();
      expect(names.has(spec.name), `duplicate ${spec.phase}/${spec.name}`).toBe(false);
      names.add(spec.name);
      seen.set(spec.phase, names);
    }
  });

  it("does not register deprecated sessionItem/file handler", () => {
    const deprecated = buildDefaultObserverManifest().filter(
      (spec) => spec.phase === "sessionItem" && spec.name === "file",
    );
    expect(deprecated).toEqual([]);
  });

  it("does not register sessionItem agent-event-derive after M6 RunEvent derive", () => {
    const derive = buildDefaultObserverManifest().find(
      (spec) => spec.phase === "sessionItem" && spec.name === "agent-event-derive",
    );
    expect(derive).toBeUndefined();
  });
});
