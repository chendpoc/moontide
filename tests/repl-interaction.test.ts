import { describe, expect, it } from "vitest";

import { createReplUserInteraction } from "../src/cli/repl/interaction.js";

function mockReadline(answers: string[]) {
  let index = 0;
  return {
    question: async () => answers[index++] ?? "",
  };
}

describe("createReplUserInteraction", () => {
  it("denies tool approval when user declines", async () => {
    const ui = createReplUserInteraction(mockReadline(["n"]) as never);
    const ok = await ui.approveTool({
      toolName: "bash",
      input: { command: "rm x" },
    });
    expect(ok).toBe(false);
  });

  it("approves tool when user confirms", async () => {
    const ui = createReplUserInteraction(mockReadline(["yes"]) as never);
    const ok = await ui.approveTool({
      toolName: "bash",
      input: { command: "rm x" },
    });
    expect(ok).toBe(true);
  });

  it("collects askQuestion answers from readline", async () => {
    const ui = createReplUserInteraction(mockReadline(["2"]) as never);
    const answers = await ui.askQuestion({
      title: "Runtime",
      questions: [
        {
          id: "runtime",
          prompt: "Pick runtime",
          options: [
            { id: "tsx", label: "TypeScript" },
            { id: "python", label: "Python" },
          ],
        },
      ],
    });
    expect(answers).toEqual([{ question_id: "runtime", selected: ["python"] }]);
  });

  it("defaults to first option when readline is empty", async () => {
    const ui = createReplUserInteraction(mockReadline([""]) as never);
    const answers = await ui.askQuestion({
      questions: [
        {
          id: "runtime",
          prompt: "Pick runtime",
          options: [{ id: "tsx", label: "TypeScript" }],
        },
      ],
    });
    expect(answers).toEqual([{ question_id: "runtime", selected: ["tsx"] }]);
  });
});
