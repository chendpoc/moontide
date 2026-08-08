import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { globFiles } from "@moontide/shared/utils/glob.js";
import { writeText } from "@moontide/shared/utils/fs.js";
import { joinPath } from "@moontide/shared/utils/path.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-utils-glob-");
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
