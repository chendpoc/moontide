import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setWorkdir } from "../apps/moontide/src/config.js";
import { runBash, runEdit, runListDir, runRead, runWrite, safePath } from "@moontide/tools";
import { joinPath } from "@moontide/shared/utils/path.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-");
  setWorkdir(tmpDir);
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
});

describe("tools", () => {
  it("writes and reads files", () => {
    expect(runWrite(tmpDir, "demo.txt", "hello\nworld")).toContain("Wrote");
    expect(runRead(tmpDir, "demo.txt")).toContain("hello");
  });

  it("edits files", () => {
    runWrite(tmpDir, "edit.txt", "foo bar baz");
    expect(runEdit(tmpDir, "edit.txt", "bar", "qux")).toContain("Edited");
    expect(runRead(tmpDir, "edit.txt")).toBe("foo qux baz");
  });

  it("blocks path escape", () => {
    expect(() => safePath("../escape.txt", tmpDir)).toThrow(/escapes workspace/);
  });

  it("reads with offset and limit", () => {
    runWrite(tmpDir, "lines.txt", "a\nb\nc\nd\ne");
    expect(runRead(tmpDir, "lines.txt", 2, 2)).toBe("b\nc\n... (2 more lines)");
  });

  it("lists directory entries", () => {
    fs.mkdirSync(joinPath(tmpDir, "src"));
    runWrite(tmpDir, "src/a.ts", "x");
    runWrite(tmpDir, "b.txt", "y");
    const listing = runListDir(tmpDir, ".");
    expect(listing).toContain("dir\tsrc");
    expect(listing).toContain("file\tb.txt");
  });

  it("runs bash echo", async () => {
    const output = await runBash(tmpDir, "echo harness");
    expect(output).toContain("harness");
  });
});
