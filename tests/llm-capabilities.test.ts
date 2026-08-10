import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  findCapabilityDeclaration,
  listAdapterCapabilityDeclarations,
  lookupCapabilityStatus,
} from "../packages/llm/src/capabilities/index.js";
import { repoPath } from "./helpers/source-scan.js";

describe("llm capabilities", () => {
  it("lists DeepSeek chat and responses declarations", () => {
    const rows = listAdapterCapabilityDeclarations();
    expect(rows.some((row) => row.adapterFamily === "openai-chat-completions")).toBe(true);
    expect(rows.some((row) => row.adapterFamily === "openai-responses")).toBe(true);
  });

  it("count_tokens is chat route only, not responses", () => {
    expect(
      lookupCapabilityStatus({
        capability: "count_tokens",
        providerPresetId: "deepseek",
        adapterFamily: "openai-chat-completions",
      }),
    ).toBe("supported");
    expect(
      lookupCapabilityStatus({
        capability: "count_tokens",
        providerPresetId: "deepseek",
        adapterFamily: "openai-responses",
      }),
    ).toBe("rejected");
  });

  it("max_output_tokens is responses-only capability", () => {
    expect(
      lookupCapabilityStatus({
        capability: "max_output_tokens",
        providerPresetId: "deepseek",
        adapterFamily: "openai-responses",
      }),
    ).toBe("supported");
    expect(
      lookupCapabilityStatus({
        capability: "max_output_tokens",
        providerPresetId: "deepseek",
        adapterFamily: "openai-chat-completions",
      }),
    ).toBe("rejected");
  });

  it("lookupCapabilityStatus returns declared status", () => {
    expect(
      lookupCapabilityStatus({
        capability: "reasoning_effort.medium",
        providerPresetId: "deepseek",
        adapterFamily: "openai-chat-completions",
      }),
    ).toBe("emulated");
  });

  it("lookupCapabilityStatus defaults unknown capability to rejected", () => {
    expect(
      lookupCapabilityStatus({
        capability: "conversation.state",
        providerPresetId: "deepseek",
        adapterFamily: "openai-chat-completions",
      }),
    ).toBe("rejected");
  });

  it("every declaration has a non-empty capability id", () => {
    for (const row of listAdapterCapabilityDeclarations()) {
      expect(row.capability.length).toBeGreaterThan(0);
      expect(["supported", "ignored", "rejected", "emulated"]).toContain(row.status);
      expect(findCapabilityDeclaration(row)).toEqual(row);
    }
  });

  it("every contractTest references an existing test file", () => {
    for (const row of listAdapterCapabilityDeclarations()) {
      if (!row.contractTest) {
        continue;
      }
      expect(existsSync(repoPath(`tests/${row.contractTest}.test.ts`))).toBe(true);
    }
  });
});
