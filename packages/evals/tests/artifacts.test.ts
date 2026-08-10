import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createArtifactDir } from "../src/artifacts.js";

describe("createArtifactDir", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("uses local time plus a 2-char random suffix", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 10, 13, 27, 0, 123));
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);

    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "moontide-eval-artifacts-"));
    tmpDirs.push(baseDir);

    const artifactDir = createArtifactDir(baseDir);
    expect(path.basename(artifactDir)).toBe("2026-08-10_13-27-00_124f");
  });
});
