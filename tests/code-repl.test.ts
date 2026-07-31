import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setWorkdir } from "../src/config.js";
import { executeTool, toolSchemas } from "../src/agent/tools/index.js";
import { registerRuntime } from "../src/extensions/code-repl/registry.js";
import type { CodeRuntime } from "../src/extensions/code-repl/types.js";
import type { ToolContext } from "../src/agent/tools/types.js";

let tmpDir = "";

function testToolContext(
  userInteraction: ToolContext["userInteraction"],
): ToolContext {
  return {
    workdir: tmpDir,
    userInteraction,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocula-code-repl-"));
  setWorkdir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("code_repl", () => {
  it("is registered in tool schemas", () => {
    const names = toolSchemas().map((t) => t.name);
    expect(names).toContain("code_repl");
    expect(names).toContain("askUserQuestion");
  });

  it("runs inline tsx code", async () => {
    const raw = await executeTool("code_repl", {
      runtime: "tsx",
      code: 'console.log("hello from tsx")',
    });
    const result = JSON.parse(raw) as {
      exit_code?: number;
      stdout?: string;
      error?: string;
      suggestion?: string;
    };
    if (result.error) {
      expect(result.suggestion).toContain("askUserQuestion");
      return;
    }
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("hello from tsx");
  });

  it("runs inline python code", async () => {
    const raw = await executeTool("code_repl", {
      runtime: "python",
      code: 'print("hello from python")',
    });
    const result = JSON.parse(raw) as { exit_code: number; stdout: string; error?: string };
    if (result.error) {
      expect(result.suggestion).toContain("askUserQuestion");
      return;
    }
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("hello from python");
  });

  it("executes an existing file by path", async () => {
    fs.writeFileSync(path.join(tmpDir, "script.js"), 'console.log("from file")', "utf8");
    const raw = await executeTool("code_repl", {
      runtime: "node",
      path: "script.js",
    });
    const result = JSON.parse(raw) as { exit_code: number; stdout: string };
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("from file");
  });

  it("writes code to path then executes", async () => {
    const raw = await executeTool("code_repl", {
      runtime: "node",
      path: "nested/run.js",
      code: 'console.log("written")',
    });
    const result = JSON.parse(raw) as { exit_code: number; stdout: string };
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("written");
    expect(fs.existsSync(path.join(tmpDir, "nested/run.js"))).toBe(true);
  });

  it("rejects path escape", async () => {
    const raw = await executeTool("code_repl", {
      runtime: "node",
      path: "../../../etc/passwd",
      code: 'console.log("nope")',
    });
    const result = JSON.parse(raw) as { error: string };
    expect(result.error).toMatch(/escapes workspace/);
  });

  it("returns suggestion when runtime unavailable", async () => {
    const mockRuntime: CodeRuntime = {
      id: "mock_missing",
      extensions: [".mock"],
      description: "always missing",
      async detect() {
        return { available: false, error: "mock not installed" };
      },
      buildCommand(ctx) {
        return { cmd: "mock_missing", args: [ctx.filePath] };
      },
    };
    registerRuntime(mockRuntime);
    const raw = await executeTool("code_repl", {
      runtime: "mock_missing",
      code: "noop",
    });
    const result = JSON.parse(raw) as { error: string; suggestion: string };
    expect(result.error).toMatch(/not available|mock not installed/);
    expect(result.suggestion).toContain("askUserQuestion");
  });

  it("requires code or path", async () => {
    const raw = await executeTool("code_repl", { runtime: "tsx" });
    const result = JSON.parse(raw) as { error: string };
    expect(result.error).toContain("Either code, path, or template");
  });
});

describe("askUserQuestion", () => {
  it("returns error when prompt not configured", async () => {
    const raw = await executeTool("askUserQuestion", {
      questions: [
        {
          id: "runtime",
          prompt: "Pick runtime",
          options: [{ id: "tsx", label: "TypeScript" }],
        },
      ],
    });
    const result = JSON.parse(raw) as { error: string };
    expect(result.error).toContain("not configured");
  });

  it("collects answers when prompt configured", async () => {
    const raw = await executeTool(
      "askUserQuestion",
      {
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
      },
      testToolContext({
        approveTool: async () => false,
        askQuestion: async () => [{ question_id: "runtime", selected: ["python"] }],
      }),
    );
    const result = JSON.parse(raw) as { answers: Array<{ question_id: string; selected: string[] }> };
    expect(result.answers[0]?.selected).toEqual(["python"]);
  });
});
