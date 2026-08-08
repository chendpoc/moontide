import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setWorkdir } from "../apps/moontide/src/config.js";
import { executeTool, getToolDefinitions } from "../apps/moontide/src/tools/index.js";
import { registerRuntime, type CodeRuntime } from "@moontide/tools";
import { joinPath } from "@moontide/shared/utils/path.js";
import {
  clearTestRuntime,
  getTestRuntime,
  installTestRuntime,
  testToolContext,
} from "./helpers/test-runtime.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-code-repl-");
  setWorkdir(tmpDir);
  installTestRuntime(tmpDir);
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
  clearTestRuntime();
});

describe("code_repl", { timeout: 30_000 }, () => {
  it("is registered in tool schemas", () => {
    const names = getToolDefinitions(getTestRuntime().tools).map((t) => t.name);
    expect(names).toContain("code_repl");
    expect(names).toContain("askUserQuestion");
  });

  it("runs inline tsx code", async () => {
    const raw = await executeTool("code_repl", {
      runtime: "tsx",
      code: 'console.log("hello from tsx")',
    }, testToolContext(tmpDir));
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
    }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as { exit_code: number; stdout: string; error?: string };
    if (result.error) {
      expect(result.suggestion).toContain("askUserQuestion");
      return;
    }
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("hello from python");
  });

  it("executes an existing file by path", async () => {
    fs.writeFileSync(joinPath(tmpDir, "script.js"), 'console.log("from file")', "utf8");
    const raw = await executeTool("code_repl", {
      runtime: "node",
      path: "script.js",
    }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as { exit_code: number; stdout: string };
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("from file");
  });

  it("writes code to path then executes", async () => {
    const raw = await executeTool("code_repl", {
      runtime: "node",
      path: "nested/run.js",
      code: 'console.log("written")',
    }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as { exit_code: number; stdout: string };
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("written");
    expect(fs.existsSync(joinPath(tmpDir, "nested/run.js"))).toBe(true);
  });

  it("rejects path escape", async () => {
    const raw = await executeTool("code_repl", {
      runtime: "node",
      path: "../../../etc/passwd",
      code: 'console.log("nope")',
    }, testToolContext(tmpDir));
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
    }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as { error: string; suggestion: string };
    expect(result.error).toMatch(/not available|mock not installed/);
    expect(result.suggestion).toContain("askUserQuestion");
  });

  it("requires code or path", async () => {
    const raw = await executeTool("code_repl", { runtime: "tsx" }, testToolContext(tmpDir));
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
    }, testToolContext(tmpDir));
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
      testToolContext(tmpDir, {
        approveTool: async () => false,
        askQuestion: async () => [{ question_id: "runtime", selected: ["python"] }],
      }),
    );
    const result = JSON.parse(raw) as { answers: Array<{ question_id: string; selected: string[] }> };
    expect(result.answers[0]?.selected).toEqual(["python"]);
  });
});
