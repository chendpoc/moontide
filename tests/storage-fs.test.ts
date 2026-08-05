import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendNdjsonLine, ensureDir, writeJsonPretty } from "../src/storage/fs.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";
import { joinPath } from "../src/utils/path.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-storage-");
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
});

describe("storage/fs", () => {
  it("appendNdjsonLine appends UTF-8 lines", () => {
    const filePath = joinPath(tmpDir, "log.jsonl");
    appendNdjsonLine(filePath, '{"a":1}\n');
    appendNdjsonLine(filePath, '{"b":2}\n');
    expect(fs.readFileSync(filePath, "utf8")).toBe('{"a":1}\n{"b":2}\n');
  });

  it("writeJsonPretty creates parent dirs and writes JSON", () => {
    const filePath = joinPath(tmpDir, "nested", "status.json");
    writeJsonPretty(filePath, { ok: true });
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({ ok: true });
  });

  it("ensureDir is idempotent", () => {
    const dirPath = joinPath(tmpDir, "a", "b");
    ensureDir(dirPath);
    ensureDir(dirPath);
    expect(fs.statSync(dirPath).isDirectory()).toBe(true);
  });
});
