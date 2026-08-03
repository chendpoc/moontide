import { describe, expect, it } from "vitest";

import { composeContextV1 } from "../src/context/composer/compose.js";
import { resolveToolDefinitions } from "../src/context/composer/tool-definitions/index.js";

describe("composeContextV1", () => {
  it("includes resolved Tool Definitions in request", () => {
    const messages = [{ role: "user" as const, content: "hi" }];
    const composed = composeContextV1({ turn: 1, messages, system: "sys" });

    expect(composed.request.system).toBe("sys");
    expect(composed.request.messages).toBe(messages);
    expect(composed.request.tools).toEqual(resolveToolDefinitions());
  });

  it("records tool names in manifest", () => {
    const composed = composeContextV1({
      turn: 2,
      messages: [],
      system: "sys",
    });

    expect(composed.manifest.turn).toBe(2);
    expect(composed.manifest.toolDefinitionNames).toEqual(
      resolveToolDefinitions().map((tool) => tool.name),
    );
  });
});
