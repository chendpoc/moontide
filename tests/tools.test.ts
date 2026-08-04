import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setWorkdir } from "../src/config.js";
import { runBash } from "../src/tools/builtins/bash.js";
import { runEdit, runListDir, runRead, runWrite, safePath } from "../src/tools/builtins/fs.js";
import { joinPath } from "../src/utils/path.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("ocula-");
  setWorkdir(tmpDir);
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
});

describe("tools", () => {
  it("writes and reads files", () => {
    expect(runWrite("demo.txt", "hello\nworld")).toContain("Wrote");
    expect(runRead("demo.txt")).toContain("hello");
  });

  it("edits files", () => {
    runWrite("edit.txt", "foo bar baz");
    expect(runEdit("edit.txt", "bar", "qux")).toContain("Edited");
    expect(runRead("edit.txt")).toBe("foo qux baz");
  });

  it("blocks path escape", () => {
    expect(() => safePath("../escape.txt")).toThrow(/escapes workspace/);
  });

  it("reads with offset and limit", () => {
    runWrite("lines.txt", "a\nb\nc\nd\ne");
    expect(runRead("lines.txt", 2, 2)).toBe("b\nc\n... (2 more lines)");
  });

  it("lists directory entries", () => {
    fs.mkdirSync(joinPath(tmpDir, "src"));
    runWrite("src/a.ts", "x");
    runWrite("b.txt", "y");
    const listing = runListDir(".");
    expect(listing).toContain("dir\tsrc");
    expect(listing).toContain("file\tb.txt");
  });

  it("runs bash echo", async () => {
    const output = await runBash("echo harness");
    expect(output).toContain("harness");
  });
});
