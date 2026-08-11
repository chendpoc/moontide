import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapPlugins } from "@moontide/sidecar-host";
import { dataPath, joinPath } from "@moontide/shared/utils/path.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-plugin-host-");
  installTestRuntime(tmpDir);
});

afterEach(() => {
  clearTestRuntime();
  removeTmpWorkdir(tmpDir);
  vi.restoreAllMocks();
});

describe("sidecar plugin attach", () => {
  it("registers in-process hooks and namespaced tools", async () => {
    const runtime = installTestRuntime(tmpDir);
    const fixtureEntry = joinPath(import.meta.dirname, "fixtures/hello-sidecar/index.js");
    fs.mkdirSync(dataPath(tmpDir), { recursive: true });
    fs.writeFileSync(
      dataPath(tmpDir, "plugins.json"),
      JSON.stringify({
        plugins: [
          {
            id: "hello",
            kind: "sidecar",
            attach: "startup",
            entry: fixtureEntry,
            transport: "in-process",
          },
        ],
      }),
      "utf8",
    );

    await bootstrapPlugins(tmpDir, runtime.plugins);

    expect(runtime.plugins.listAttached()).toHaveLength(1);
    expect(runtime.tools.getTool("hello__echo")).toBeDefined();

    await runtime.observers.dispatch("runStart", { userPrompt: "plugin time" });
  });
});
