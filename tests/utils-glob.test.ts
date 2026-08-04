import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { globFiles } from "../src/utils/glob.js";
import { writeText } from "../src/utils/fs.js";
import { joinPath } from "../src/utils/path.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("ocula-utils-glob-");
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
});

describe("utils/glob", () => {
  it("finds files by pattern", () => {
    writeText(joinPath(tmpDir, "a.md"), "a");
    writeText(joinPath(tmpDir, "b.txt"), "b");
    expect(globFiles("*.md", { cwd: tmpDir }).sort()).toEqual(["a.md"]);
  });
});
