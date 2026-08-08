import { describe, expect, it } from "vitest";

import { effectiveDecision } from "@moontide/tools";

describe("trust policy", () => {
  it("deny always wins over always policy", () => {
    expect(effectiveDecision("deny", "always")).toBe("deny");
  });

  it("allow stays allow regardless of policy", () => {
    expect(effectiveDecision("allow", "ask")).toBe("allow");
    expect(effectiveDecision("allow", "always")).toBe("allow");
  });

  it("ask becomes allow when policy is always", () => {
    expect(effectiveDecision("ask", "always")).toBe("allow");
  });

  it("ask stays ask when policy is ask", () => {
    expect(effectiveDecision("ask", "ask")).toBe("ask");
  });
});
