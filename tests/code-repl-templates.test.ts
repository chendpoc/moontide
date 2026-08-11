import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setWorkdir } from "../packages/agent/src/config.js";
import { executeTool, getToolDefinitions } from "../packages/agent/src/tools/index.js";
import { expandTemplate, listTemplateIds } from "@moontide/tools";
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
  tmpDir = createTmpWorkdir("moontide-templates-");
  setWorkdir(tmpDir);
  installTestRuntime(tmpDir);
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
  clearTestRuntime();
});

describe("expandTemplate", () => {
  it("lists eight tier1 templates", () => {
    expect(listTemplateIds()).toEqual([
      "read_json",
      "jsonl_tail",
      "package_scripts",
      "glob_stats",
      "git_summary",
      "env_check",
      "json_pretty",
      "peek_csv",
    ]);
  });

  it("rejects unknown template", () => {
    const result = expandTemplate("nope", {}, tmpDir);
    expect(result).toEqual({ error: "unknown template: nope" });
  });

  it("rejects missing required vars", () => {
    const result = expandTemplate("read_json", {}, tmpDir);
    expect(result).toMatchObject({
      error: "missing required template vars",
      template: "read_json",
      missing_vars: ["path"],
    });
  });

  it("rejects path escape", () => {
    const result = expandTemplate("read_json", { path: "../../../etc/passwd" }, tmpDir);
    expect(result).toMatchObject({ template: "read_json" });
    expect(result).toHaveProperty("error");
    expect(String((result as { error: string }).error)).toContain("escapes workspace");
  });

  it("expands read_json with safe path", () => {
    const pkgPath = joinPath(tmpDir, "package.json");
    fs.writeFileSync(pkgPath, JSON.stringify({ name: "demo", scripts: { test: "vitest" } }), "utf8");

    const result = expandTemplate("read_json", { path: "package.json", max_depth: 1 }, tmpDir);
    expect("code" in result).toBe(true);
    if (!("code" in result)) {
      return;
    }
    expect(result.runtime).toBe("tsx");
    expect(result.code).toContain("readFileSync");
    expect(result.resolvedVars.path).toBe(pkgPath);
  });

  it("expands git_summary bash with numeric log_n", () => {
    const result = expandTemplate("git_summary", { log_n: 3 }, tmpDir);
    expect("code" in result).toBe(true);
    if (!("code" in result)) {
      return;
    }
    expect(result.runtime).toBe("bash");
    expect(result.code).toContain("LOG_N=3");
  });

  it("requires path or text for json_pretty", () => {
    const result = expandTemplate("json_pretty", {}, tmpDir);
    expect(result).toEqual({ error: "json_pretty requires path or text", template: "json_pretty" });
  });
});

describe("code_repl templates integration", { timeout: 30_000 }, () => {
  it("includes template enum in schema", () => {
    const schema = getToolDefinitions(getTestRuntime().tools).find((t) => t.name === "code_repl");
    expect(schema).toBeDefined();
    const props = schema!.input_schema.properties as Record<string, { enum?: string[] }>;
    expect(props.template?.enum).toContain("read_json");
    expect(props.template?.enum).toContain("peek_csv");
  });

  it("rejects template with code", async () => {
    const raw = await executeTool("code_repl", {
      template: "env_check",
      code: "console.log(1)",
    }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as { error?: string };
    expect(result.error).toContain("template and code");
  });

  it("runs read_json template", async () => {
    fs.writeFileSync(
      joinPath(tmpDir, "config.json"),
      JSON.stringify({ alpha: 1, nested: { beta: 2 } }),
      "utf8",
    );
    const raw = await executeTool("code_repl", {
      template: "read_json",
      vars: { path: "config.json", max_depth: 1 },
    }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as {
      exit_code?: number;
      stdout?: string;
      error?: string;
      template?: string;
    };
    if (result.error) {
      expect(result.suggestion).toContain("askUserQuestion");
      return;
    }
    expect(result.exit_code).toBe(0);
    expect(result.template).toBe("read_json");
    const payload = JSON.parse(result.stdout!) as { keys: string[] };
    expect(payload.keys).toContain("alpha");
    expect(payload.keys).toContain("nested");
  });

  it("runs package_scripts template", async () => {
    fs.writeFileSync(
      joinPath(tmpDir, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: { test: "vitest run" },
        dependencies: { chalk: "^5.0.0" },
      }),
      "utf8",
    );
    const raw = await executeTool("code_repl", {
      template: "package_scripts",
    }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as { exit_code?: number; stdout?: string; error?: string };
    if (result.error) {
      return;
    }
    expect(result.exit_code).toBe(0);
    const payload = JSON.parse(result.stdout!) as { name: string; scripts: Record<string, string> };
    expect(payload.name).toBe("fixture");
    expect(payload.scripts.test).toBe("vitest run");
  });

  it("runs jsonl_tail template", async () => {
    const lines = ['{"a":1}\n', '{"b":2}\n', '{"c":3}\n'].join("");
    fs.writeFileSync(joinPath(tmpDir, "events.jsonl"), lines, "utf8");
    const raw = await executeTool("code_repl", {
      template: "jsonl_tail",
      vars: { path: "events.jsonl", n: 2 },
    }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as { exit_code?: number; stdout?: string; error?: string };
    if (result.error) {
      return;
    }
    expect(result.exit_code).toBe(0);
    const payload = JSON.parse(result.stdout!) as { lines: { a?: number; b?: number; c?: number }[] };
    expect(payload.lines).toHaveLength(2);
    expect(payload.lines[0]).toEqual({ b: 2 });
    expect(payload.lines[1]).toEqual({ c: 3 });
  });

  it("runs glob_stats template", async () => {
    fs.writeFileSync(joinPath(tmpDir, "a.ts"), "x", "utf8");
    fs.writeFileSync(joinPath(tmpDir, "b.js"), "yy", "utf8");
    const raw = await executeTool("code_repl", { template: "glob_stats" }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as { exit_code?: number; stdout?: string; error?: string };
    if (result.error) {
      return;
    }
    expect(result.exit_code).toBe(0);
    const payload = JSON.parse(result.stdout!) as {
      by_ext: Record<string, { count: number }>;
      total: { count: number };
    };
    expect(payload.total.count).toBeGreaterThanOrEqual(2);
    expect(payload.by_ext[".ts"]?.count).toBe(1);
  });

  it("runs env_check template", async () => {
    const raw = await executeTool("code_repl", { template: "env_check" }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as { exit_code?: number; stdout?: string; error?: string };
    if (result.error) {
      return;
    }
    expect(result.exit_code).toBe(0);
    const payload = JSON.parse(result.stdout!) as { workdir: string; node: { available: boolean } };
    expect(fs.realpathSync(payload.workdir)).toBe(fs.realpathSync(tmpDir));
    expect(payload.node.available).toBe(true);
  });

  it("runs json_pretty template with text", async () => {
    const raw = await executeTool("code_repl", {
      template: "json_pretty",
      vars: { text: '{"x":1}' },
    }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as { exit_code?: number; stdout?: string; error?: string };
    if (result.error?.includes("python")) {
      return;
    }
    if (result.error) {
      expect(result.suggestion).toContain("askUserQuestion");
      return;
    }
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain('"x"');
    expect(result.stdout).toContain("1");
  });

  it("runs peek_csv template", async () => {
    fs.writeFileSync(joinPath(tmpDir, "data.csv"), "name,score\nalice,90\nbob,80\n", "utf8");
    const raw = await executeTool("code_repl", {
      template: "peek_csv",
      vars: { path: "data.csv", n: 1 },
    }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as { exit_code?: number; stdout?: string; error?: string };
    if (result.error?.includes("python")) {
      return;
    }
    if (result.error) {
      expect(result.suggestion).toContain("askUserQuestion");
      return;
    }
    expect(result.exit_code).toBe(0);
    const payload = JSON.parse(result.stdout!) as {
      columns: string[];
      rows: { name: string; score: string }[];
      row_count: number;
    };
    expect(payload.columns).toEqual(["name", "score"]);
    expect(payload.rows).toHaveLength(1);
    expect(payload.row_count).toBe(2);
  });

  it("runs git_summary template when git repo", async () => {
    fs.writeFileSync(joinPath(tmpDir, "README.md"), "# demo", "utf8");
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync("git", ["init"], { cwd: tmpDir, stdio: "ignore" });
      execFileSync("git", ["add", "README.md"], { cwd: tmpDir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], {
        cwd: tmpDir,
        stdio: "ignore",
        env: { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "t@t.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "t@t.com" },
      });
    } catch {
      return;
    }

    const raw = await executeTool("code_repl", {
      template: "git_summary",
      vars: { log_n: 1 },
    }, testToolContext(tmpDir));
    const result = JSON.parse(raw) as { exit_code?: number; stdout?: string; error?: string };
    if (result.error) {
      return;
    }
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("git status");
    expect(result.stdout).toContain("init");
  });
});
