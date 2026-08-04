import { describe, expect, it } from "vitest";

import { buildDefaultHookManifest } from "../src/agent/hooks/manifest.js";
import { PHASE_DEFS, type HookErrorPolicy } from "../src/agent/hooks/phases.js";

const VALID_ERROR_POLICIES = new Set<HookErrorPolicy>(["fail-open", "fail-closed"]);

describe("default hook manifest conformance", () => {
  it("registers only known phases with unique names per phase", () => {
    const seen = new Map<string, Set<string>>();

    for (const spec of buildDefaultHookManifest()) {
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
    const deprecated = buildDefaultHookManifest().filter(
      (spec) => spec.phase === "sessionItem" && spec.name === "file",
    );
    expect(deprecated).toEqual([]);
  });

  it("derives agent events via agent-event-derive on sessionItem", () => {
    const derive = buildDefaultHookManifest().find(
      (spec) => spec.phase === "sessionItem" && spec.name === "agent-event-derive",
    );
    expect(derive).toBeDefined();
    expect(derive?.errorPolicy ?? PHASE_DEFS.sessionItem.defaultErrorPolicy).toBe("fail-open");
  });
});
