import path from "node:path";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import * as pty from "node-pty";
import { describe, expect, it, afterEach, beforeAll } from "vitest";

import { stripAnsi } from "@moontide/shared/utils/text.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const harnessPath = path.join(root, "tests/fixtures/repl-terminal-pty-harness.ts");
const tsxCli = path.join(root, "node_modules/tsx/dist/cli.mjs");
const tsconfigDev = path.join(root, "tsconfig.dev.json");

function ensurePtySpawnHelperExecutable(): void {
  if (process.platform !== "darwin") {
    return;
  }
  const require = createRequire(import.meta.url);
  const ptyDir = path.dirname(require.resolve("node-pty/package.json"));
  for (const arch of ["darwin-arm64", "darwin-x64"] as const) {
    const helper = path.join(ptyDir, "prebuilds", arch, "spawn-helper");
    try {
      chmodSync(helper, 0o755);
    } catch {
      // prebuild may be absent on this arch
    }
  }
}

beforeAll(() => {
  ensurePtySpawnHelperExecutable();
});

function isPtySpawnAvailable(): boolean {
  try {
    const proc = pty.spawn(process.execPath, ["-e", "process.exit(0)"], {
      name: "xterm",
      cols: 80,
      rows: 24,
    });
    proc.kill();
    return true;
  } catch {
    return false;
  }
}

const ptyAvailable = isPtySpawnAvailable();

function spawnHarness(mode: string, input: string, timeoutMs = 25_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let settled = false;

    const ptyProcess = pty.spawn(process.execPath, [tsxCli, "--tsconfig", tsconfigDev, harnessPath], {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: root,
      env: { ...process.env, HARNESS_MODE: mode },
    });

    const finish = (result: string | Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        ptyProcess.kill();
      } catch {
        // process may already be gone
      }
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      finish(new Error(`harness timeout mode=${mode}\n${chunks.join("")}`));
    }, timeoutMs);

    ptyProcess.onData((data) => {
      chunks.push(data);
      if (data.includes("<<DONE>>")) {
        setTimeout(() => finish(chunks.join("")), 150);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      const combined = chunks.join("");
      if (combined.includes("<<DONE>>")) {
        finish(combined);
        return;
      }
      if (exitCode !== 0) {
        finish(new Error(`harness exit ${exitCode}\n${combined}`));
      } else if (!settled) {
        finish(combined);
      }
    });

    setTimeout(() => {
      if (input.length > 0) {
        ptyProcess.write(input);
      }
    }, 600);
  });
}

function parseMarker(output: string, name: string): string | null {
  const match = output.match(new RegExp(`<<${name}:([^>]+)>>`));
  return match?.[1] ?? null;
}

describe.skipIf(!ptyAvailable)("repl terminal PTY", () => {
  it("shows prompt and echoes user line in quiet mode", async () => {
    const output = await spawnHarness("prompt-echo", "hello world\r");
    const text = stripAnsi(output);

    expect(text).toContain("<<STACK_PINNED>>");
    expect(text).toContain("MoonTide >>");
    expect(text).toContain("<<PROMPT_DONE>>");
    expect(text).toMatch(/›.*hello world/);
    expect(text).toContain("<<USER_ECHOED>>");
  }, 20_000);

  it("does not duplicate status stack on identical rerender during readline", async () => {
    const output = await spawnHarness("status-dedup", "typed input\r");
    const text = stripAnsi(output);

    const afterFirst = Number(parseMarker(text, "WRITES_FIRST"));
    const afterSecond = Number(parseMarker(text, "WRITES_SECOND"));
    expect(afterFirst).toBeGreaterThan(0);
    expect(afterSecond).toBe(afterFirst);

    expect(text).toContain("<<PROMPT_WITH_ACTIVITY>>");
    expect(text).toContain("typed input");
  }, 30_000);

  it("writes final-message-only assistant reply once", async () => {
    const output = await spawnHarness("final-message-only", "", 30_000);
    const text = stripAnsi(output);

    expect(text).toContain("table query");
    expect(text).toContain("| 1 | Sophie |");
    expect(text).toContain("<<ASSISTANT_DONE>>");
    const matches = text.match(/\| 1 \| Sophie \|/g) ?? [];
    expect(matches).toHaveLength(1);
  }, 35_000);
});

describe("repl terminal non-TTY fallback", () => {
  afterEach(async () => {
    const { resetStatusLineRender } = await import(
      "../packages/agent-cli/src/cli/statusline/render.js"
    );
    resetStatusLineRender();
  });

  it("writes status stack as plain lines without cursor-up escapes", async () => {
    const writes: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    const originalIsTTY = process.stderr.isTTY;

    process.stderr.write = ((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true });

    try {
      const { renderStatusStackAsync, clearStatusStackCacheForTest } = await import(
        "../packages/agent-cli/src/cli/statusline/render-stack.js"
      );
      clearStatusStackCacheForTest();
      await renderStatusStackAsync();
      const combined = writes.join("");
      expect(combined).not.toContain("\x1b[");
      expect(stripAnsi(combined)).toContain("MoonTide");
    } finally {
      process.stderr.write = originalWrite;
      Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });
});
