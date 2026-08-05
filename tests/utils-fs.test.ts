import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  exists,
  readLines,
  readText,
  readTextIfExists,
  writeText,
} from "../src/utils/fs.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";
import { joinPath } from "../src/utils/path.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-utils-fs-");
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
});

describe("utils/fs", () => {
  it("writeText creates parent dirs and readText roundtrips", () => {
    const filePath = joinPath(tmpDir, "nested", "file.txt");
    writeText(filePath, "hello");
    expect(readText(filePath)).toBe("hello");
    expect(exists(filePath)).toBe(true);
  });

  it("readTextIfExists returns undefined for missing files", () => {
    expect(readTextIfExists(joinPath(tmpDir, "missing.txt"))).toBeUndefined();
  });

  it("readLines skips empty files and trailing blank lines", () => {
    const filePath = joinPath(tmpDir, "log.jsonl");
    writeText(filePath, '{"a":1}\n\n{"b":2}\n');
    expect(readLines(filePath)).toEqual(['{"a":1}', '{"b":2}']);
    expect(readLines(joinPath(tmpDir, "missing.jsonl"))).toEqual([]);
  });
});
