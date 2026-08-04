import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { execFileCollect, execShell, spawnCollect } from "../src/utils/process.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("ocula-utils-process-");
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
});

describe("utils/process", () => {
  it("spawnCollect captures stdout", async () => {
    const result = await spawnCollect(process.execPath, ["-e", "console.log('hi')"], { cwd: tmpDir });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("hi");
  });

  it("execFileCollect returns non-zero exit as result", async () => {
    const result = await execFileCollect(process.execPath, ["-e", "process.exit(2)"], { cwd: tmpDir });
    expect(result.code).toBe(2);
    expect(result.error).toBeDefined();
  });

  it("execShell runs a shell command", async () => {
    const result = await execShell("echo hello", { cwd: tmpDir, timeout: 5_000 });
    expect(result.error).toBeUndefined();
    expect(result.stdout.trim()).toBe("hello");
  });
});
