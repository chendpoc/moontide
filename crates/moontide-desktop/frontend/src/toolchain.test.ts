import { describe, expect, it } from "vitest";

import ToolchainProbe from "./ToolchainProbe.svelte";

describe("frontend toolchain", () => {
  it("compiles a minimal typed Svelte component", () => {
    expect(ToolchainProbe).toBeTypeOf("function");
  });
});
