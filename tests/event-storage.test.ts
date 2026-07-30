import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonlWriter, RUNS_DIR } from "../src/events/outputs/jsonl.js";
import {
  MAX_PERSISTED_EVENT_BYTES,
  serializePersistedEvent,
} from "../src/events/persist.js";
import type { AgentEvent } from "../src/events/types.js";

let tmpDir = "";

function event(
  runId: string,
  overrides: Partial<AgentEvent> = {},
): AgentEvent {
  return {
    id: `${runId}-${crypto.randomUUID()}`,
    seq: 1,
    runId,
    turn: 1,
    phase: "post_llm",
    channel: "trace",
    kind: "thinking",
    ts: Date.now(),
    payload: { body: "hello", charCount: 5 },
    preview: "hello",
    ...overrides,
  };
}

function runsDir(): string {
  return path.join(tmpDir, ".oculeau", RUNS_DIR);
}

function readJsonl(filePath: string): AgentEvent[] {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentEvent);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oculeau-storage-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("persisted event projection", () => {
  it("removes historical conversation context and duplicate tool input", () => {
    const writer = new JsonlWriter({ workdir: tmpDir });
    const previousPrompt = "previous-run-secret";

    writer.handle(
      event("run-1", {
        channel: "conversation",
        kind: "user_prompt",
        phase: "pre_llm",
        payload: { text: previousPrompt },
      }),
    );
    writer.finalizeRun("run-1");

    writer.handle(
      event("run-2", {
        channel: "context",
        kind: "metrics_pre",
        phase: "pre_llm",
        payload: {
          report: {
            estimatedTokens: 10,
            limit: 100,
            breakdown: { total: 10 },
            messageLines: [{ preview: previousPrompt, body: previousPrompt }],
            messages: [previousPrompt],
            system: previousPrompt,
            tools: [{ description: previousPrompt }],
          },
        },
      }),
    );
    writer.handle(
      event("run-2", {
        channel: "trace",
        kind: "tool_use",
        payload: {
          toolName: "read_file",
          body: "{\"path\":\"README.md\"}",
          input: { path: "README.md" },
        },
      }),
    );
    writer.handle(
      event("run-2", {
        channel: "audit",
        kind: "tool_use",
        phase: "post_tool",
        payload: {
          toolName: "read_file",
          toolInput: { path: "README.md" },
        },
      }),
    );

    const activePath = path.join(runsDir(), "run-2.active.jsonl");
    const raw = fs.readFileSync(activePath, "utf8");
    expect(raw).not.toContain(previousPrompt);

    const persisted = readJsonl(activePath);
    const contextReport = persisted[0]?.payload.report as Record<string, unknown>;
    expect(contextReport).not.toHaveProperty("messageLines");
    expect(contextReport).not.toHaveProperty("messages");
    expect(contextReport).not.toHaveProperty("system");
    expect(contextReport).not.toHaveProperty("tools");
    expect(persisted[1]?.payload).toHaveProperty("input");
    expect(persisted[1]?.payload).not.toHaveProperty("body");
    expect(persisted[1]?.preview).toBe("read_file");
    expect(persisted[2]?.payload).toEqual({ toolName: "read_file" });
  });

  it("caps a Unicode event at 64 KiB and keeps valid JSON", () => {
    const serialized = serializePersistedEvent(
      event("unicode", {
        channel: "conversation",
        kind: "final",
        phase: "stop",
        payload: { text: "😀".repeat(100_000) },
      }),
    );

    expect(serialized.bytes).toBeLessThanOrEqual(MAX_PERSISTED_EVENT_BYTES);
    const parsed = JSON.parse(serialized.line) as {
      truncated: boolean;
      originalBytes: number;
      payload: { text: string };
    };
    expect(parsed.truncated).toBe(true);
    expect(parsed.originalBytes).toBeGreaterThan(MAX_PERSISTED_EVENT_BYTES);
    expect(parsed.payload.text).not.toContain("\uFFFD");
  });
});

describe("per-run gzip segments", () => {
  it("leaves the legacy event log untouched", () => {
    const dataDir = path.join(tmpDir, ".oculeau");
    const legacyPath = path.join(dataDir, "events.jsonl");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(legacyPath, "legacy-content\n");

    new JsonlWriter({ workdir: tmpDir });

    expect(fs.readFileSync(legacyPath, "utf8")).toBe("legacy-content\n");
  });

  it("rotates only between complete JSONL lines and compresses the final tail", () => {
    const first = event("rotate", { payload: { body: "a".repeat(400) } });
    const second = event("rotate", {
      seq: 2,
      payload: { body: "b".repeat(400) },
    });
    const firstLine = serializePersistedEvent(first).line;
    const secondLine = serializePersistedEvent(second).line;
    const writer = new JsonlWriter({
      workdir: tmpDir,
      segmentLimitBytes: Buffer.byteLength(firstLine, "utf8") + 1,
    });

    writer.handle(first);
    writer.handle(second);

    const firstArchive = path.join(runsDir(), "rotate-0001.jsonl.gz");
    const activePath = path.join(runsDir(), "rotate.active.jsonl");
    expect(gunzipSync(fs.readFileSync(firstArchive)).toString("utf8")).toBe(firstLine);
    expect(fs.readFileSync(activePath, "utf8")).toBe(secondLine);

    writer.finalizeRun("rotate");

    const secondArchive = path.join(runsDir(), "rotate-0002.jsonl.gz");
    expect(gunzipSync(fs.readFileSync(secondArchive)).toString("utf8")).toBe(secondLine);
    expect(fs.existsSync(activePath)).toBe(false);
  });

  it("recovers stale temp, sealed, and active files on startup", () => {
    fs.mkdirSync(runsDir(), { recursive: true });
    const sealedLine = serializePersistedEvent(event("sealed")).line;
    const activeLine = serializePersistedEvent(event("active")).line;
    fs.writeFileSync(path.join(runsDir(), "sealed-0001.jsonl.sealed"), sealedLine);
    fs.writeFileSync(path.join(runsDir(), "sealed-0001.jsonl.gz.tmp"), "partial");
    fs.writeFileSync(path.join(runsDir(), "active.active.jsonl"), activeLine);

    new JsonlWriter({ workdir: tmpDir });

    expect(fs.existsSync(path.join(runsDir(), "sealed-0001.jsonl.sealed"))).toBe(false);
    expect(fs.existsSync(path.join(runsDir(), "sealed-0001.jsonl.gz.tmp"))).toBe(false);
    expect(
      gunzipSync(
        fs.readFileSync(path.join(runsDir(), "sealed-0001.jsonl.gz")),
      ).toString("utf8"),
    ).toBe(sealedLine);
    expect(fs.existsSync(path.join(runsDir(), "active.active.jsonl"))).toBe(false);
    expect(
      gunzipSync(
        fs.readFileSync(path.join(runsDir(), "active-0001.jsonl.gz")),
      ).toString("utf8"),
    ).toBe(activeLine);
  });

  it("keeps sealed input when compression fails and recovers it later", () => {
    const first = event("retry", { payload: { body: "a".repeat(300) } });
    const second = event("retry", {
      seq: 2,
      payload: { body: "b".repeat(300) },
    });
    const firstLine = serializePersistedEvent(first).line;
    const writer = new JsonlWriter({
      workdir: tmpDir,
      segmentLimitBytes: Buffer.byteLength(firstLine, "utf8") + 1,
      gzip: () => {
        throw new Error("compression failed");
      },
    });

    writer.handle(first);
    writer.handle(second);
    expect(fs.existsSync(path.join(runsDir(), "retry-0001.jsonl.sealed"))).toBe(true);
    expect(fs.existsSync(path.join(runsDir(), "retry.active.jsonl"))).toBe(true);

    new JsonlWriter({ workdir: tmpDir });

    expect(fs.existsSync(path.join(runsDir(), "retry-0001.jsonl.sealed"))).toBe(false);
    expect(fs.existsSync(path.join(runsDir(), "retry-0001.jsonl.gz"))).toBe(true);
  });

  it("deletes complete runs as a group while preserving active runs", () => {
    const writer = new JsonlWriter({
      workdir: tmpDir,
      maxCompletedRuns: 2,
      maxArchiveBytes: Number.MAX_SAFE_INTEGER,
    });
    fs.mkdirSync(runsDir(), { recursive: true });
    const compressed = gzipSync(Buffer.from('{"ok":true}\n'));

    for (const [index, runId] of ["old", "middle", "new"].entries()) {
      const filePath = path.join(runsDir(), `${runId}-0001.jsonl.gz`);
      fs.writeFileSync(filePath, compressed);
      const time = new Date(1_700_000_000_000 + index * 1_000);
      fs.utimesSync(filePath, time, time);
    }
    writer.handle(event("active"));
    writer.handle(event("finished"));
    writer.finalizeRun("finished");

    expect(fs.existsSync(path.join(runsDir(), "old-0001.jsonl.gz"))).toBe(false);
    expect(fs.existsSync(path.join(runsDir(), "middle-0001.jsonl.gz"))).toBe(false);
    expect(fs.existsSync(path.join(runsDir(), "new-0001.jsonl.gz"))).toBe(true);
    expect(fs.existsSync(path.join(runsDir(), "finished-0001.jsonl.gz"))).toBe(true);
    expect(fs.existsSync(path.join(runsDir(), "active.active.jsonl"))).toBe(true);
  });

  it("applies the byte quota to whole completed runs", () => {
    fs.mkdirSync(runsDir(), { recursive: true });
    const oldPart = gzipSync(Buffer.from("old".repeat(500)));
    const newPart = gzipSync(Buffer.from("new".repeat(500)));
    const oldFirst = path.join(runsDir(), "old-0001.jsonl.gz");
    const oldSecond = path.join(runsDir(), "old-0002.jsonl.gz");
    const newest = path.join(runsDir(), "new-0001.jsonl.gz");
    fs.writeFileSync(oldFirst, oldPart);
    fs.writeFileSync(oldSecond, oldPart);
    fs.writeFileSync(newest, newPart);
    const oldTime = new Date(1_700_000_000_000);
    const newTime = new Date(1_700_000_010_000);
    fs.utimesSync(oldFirst, oldTime, oldTime);
    fs.utimesSync(oldSecond, oldTime, oldTime);
    fs.utimesSync(newest, newTime, newTime);

    new JsonlWriter({
      workdir: tmpDir,
      maxCompletedRuns: 20,
      maxArchiveBytes: newPart.length,
    });

    expect(fs.existsSync(oldFirst)).toBe(false);
    expect(fs.existsSync(oldSecond)).toBe(false);
    expect(fs.existsSync(newest)).toBe(true);
  });
});
