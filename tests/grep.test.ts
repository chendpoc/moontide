import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setWorkdir } from "../src/config.js";
import { normalizeGrepMaxResults, runGrep } from "../src/builtins/grep.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

function mockSpawn(stdout: string, stderr = "", code = 0): void {
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    process.nextTick(() => {
      if (stdout) {
        child.stdout.emit("data", stdout);
      }
      if (stderr) {
        child.stderr.emit("data", stderr);
      }
      child.emit("close", code);
    });
    return child as ReturnType<typeof spawn>;
  });
}

let tmpDir = "";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocula-grep-"));
  setWorkdir(tmpDir);
  fs.writeFileSync(path.join(tmpDir, "demo.ts"), "export const hello = 1;\n");
  vi.mocked(spawn).mockReset();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("grep tool", () => {
  it("requires pattern", async () => {
    const raw = await runGrep({ pattern: "  " });
    const result = JSON.parse(raw) as { status: string; error: string };
    expect(result.status).toBe("error");
    expect(result.error).toContain("pattern");
  });

  it("parses rg json output", async () => {
    mockSpawn(
      [
        JSON.stringify({
          type: "match",
          data: {
            path: { text: path.join(tmpDir, "demo.ts") },
            lines: { text: "export const hello = 1;\n" },
            line_number: 1,
            submatches: [{ start: 14 }],
          },
        }),
      ].join("\n"),
      "",
      0,
    );

    const raw = await runGrep({ pattern: "hello" });
    const result = JSON.parse(raw) as {
      status: string;
      matches: Array<{ file: string; line: number; text: string }>;
    };
    expect(result.status).toBe("ok");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.file).toBe("demo.ts");
    expect(result.matches[0]!.text).toContain("hello");
  });

  it("rejects path escape", async () => {
    const raw = await runGrep({ pattern: "x", path: "../outside" });
    const result = JSON.parse(raw) as { status: string; error: string };
    expect(result.status).toBe("error");
    expect(result.error).toContain("escapes workspace");
  });

  it("caps max_results", () => {
    expect(normalizeGrepMaxResults(undefined)).toBe(50);
    expect(normalizeGrepMaxResults(999)).toBe(200);
  });
});
