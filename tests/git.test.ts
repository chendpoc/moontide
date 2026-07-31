import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setWorkdir } from "../src/config.js";
import { executeTool } from "../src/agent/tools/index.js";
import { runGitDiff, runGitLog, runGitStatus, runGitSummaryLink } from "../src/builtins/git.js";
import { checkPermission } from "../src/agent/pipeline/permission/index.js";

let tmpDir = "";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function initRepo(): boolean {
  try {
    execFileSync("git", ["init"], { cwd: tmpDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: tmpDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "test"], { cwd: tmpDir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function commitFile(relativePath: string, content: string, message: string): void {
  fs.writeFileSync(path.join(tmpDir, relativePath), content, "utf8");
  execFileSync("git", ["add", relativePath], { cwd: tmpDir, stdio: "ignore", env: GIT_ENV });
  execFileSync("git", ["commit", "-m", message], { cwd: tmpDir, stdio: "ignore", env: GIT_ENV });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocula-git-"));
  setWorkdir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("git tools", () => {
  it("git_status on clean repo", async () => {
    if (!initRepo()) {
      return;
    }
    commitFile("README.md", "# demo", "init");

    const raw = await runGitStatus();
    const result = JSON.parse(raw) as {
      status: string;
      branch?: string;
      staged_count?: number;
      unstaged_count?: number;
      untracked_count?: number;
    };
    expect(result.status).toBe("ok");
    expect(result.branch).toBeTruthy();
    expect(result.staged_count).toBe(0);
    expect(result.unstaged_count).toBe(0);
    expect(result.untracked_count).toBe(0);
  });

  it("git_status detects unstaged changes", async () => {
    if (!initRepo()) {
      return;
    }
    commitFile("README.md", "# demo", "init");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# changed", "utf8");

    const raw = await runGitStatus();
    const result = JSON.parse(raw) as { status: string; unstaged_count?: number };
    expect(result.status).toBe("ok");
    expect(result.unstaged_count).toBeGreaterThan(0);
  });

  it("git_diff stat includes changed file", async () => {
    if (!initRepo()) {
      return;
    }
    commitFile("README.md", "# demo", "init");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# changed", "utf8");

    const raw = await runGitDiff({ stat: true });
    const result = JSON.parse(raw) as { status: string; summary?: string };
    expect(result.status).toBe("ok");
    expect(result.summary).toContain("README.md");
  });

  it("git_log returns commits", async () => {
    if (!initRepo()) {
      return;
    }
    commitFile("a.txt", "a", "first");
    commitFile("b.txt", "b", "second");

    const raw = await runGitLog({ n: 2 });
    const result = JSON.parse(raw) as {
      status: string;
      commits?: Array<{ hash: string; subject: string }>;
    };
    expect(result.status).toBe("ok");
    expect(result.commits).toHaveLength(2);
    expect(result.commits![0]!.subject).toBe("second");
    expect(result.commits![1]!.subject).toBe("first");
  });

  it("returns error when not a git repo", async () => {
    const raw = await runGitStatus();
    const result = JSON.parse(raw) as { status: string; error?: string };
    expect(result.status).toBe("error");
    expect(result.error).toContain("not a git repository");
  });

  it("executeTool git_status", async () => {
    if (!initRepo()) {
      return;
    }
    commitFile("README.md", "# demo", "init");

    const raw = await executeTool("git_status", {});
    const result = JSON.parse(raw) as { status: string; branch?: string; porcelain?: string };
    expect(result.status).toBe("ok");
    expect(result.branch).toBeTruthy();
    expect(result.porcelain).toContain("main");
  });

  it("git_summary links to code_repl template", () => {
    const raw = runGitSummaryLink(3);
    const result = JSON.parse(raw) as {
      status: string;
      template: string;
      vars: { log_n: number };
    };
    expect(result.status).toBe("use_code_repl");
    expect(result.template).toBe("git_summary");
    expect(result.vars.log_n).toBe(3);
  });
});

describe("git permissions", () => {
  it("allows native git_status", () => {
    expect(checkPermission("git_status", {})).toBe("allow");
  });

  it("allows native git_diff", () => {
    expect(checkPermission("git_diff", { stat: true })).toBe("allow");
  });

  it("allows native git_log", () => {
    expect(checkPermission("git_log", { n: 5 })).toBe("allow");
  });

  it("asks for bash git status", () => {
    expect(checkPermission("bash", { command: "git status -sb" })).toBe("ask");
  });

  it("asks for bash git diff", () => {
    expect(checkPermission("bash", { command: "git diff --stat" })).toBe("ask");
  });

  it("allows bash git commit", () => {
    expect(checkPermission("bash", { command: "git commit -m 'x'" })).toBe("allow");
  });
});
