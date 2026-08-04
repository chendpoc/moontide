import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hookDispatcher, resetSidecarHooks } from "../src/agent/hooks/index.js";
import { loadPluginManifest } from "../src/plugin-host/manifest.js";
import { getPluginHost, resetPluginHost } from "../src/plugin-host/host.js";
import { bootstrapPlugins } from "../src/plugin-host/index.js";
import { getTool, resetTools } from "../src/tools/index.js";
import { dataPath, joinPath } from "../src/utils/path.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("ocula-plugin-host-");
  resetSidecarHooks();
  resetPluginHost();
  resetTools();
});

afterEach(() => {
  resetPluginHost();
  resetSidecarHooks();
  resetTools();
  removeTmpWorkdir(tmpDir);
  vi.restoreAllMocks();
});

describe("plugin manifest", () => {
  it("parses plugins.toml sidecar entries", () => {
    fs.mkdirSync(dataPath(tmpDir), { recursive: true });
    fs.writeFileSync(
      dataPath(tmpDir, "plugins.toml"),
      `[[plugins]]
id = "hello"
kind = "sidecar"
attach = "startup"
entry = "plugins/hello/index.js"
transport = "in-process"
`,
      "utf8",
    );

    const manifest = loadPluginManifest(tmpDir);
    expect(manifest.plugins).toHaveLength(1);
    expect(manifest.plugins[0]).toMatchObject({
      id: "hello",
      kind: "sidecar",
      transport: "in-process",
    });
  });
});

describe("sidecar plugin attach", () => {
  it("registers in-process hooks and namespaced tools", async () => {
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

    await bootstrapPlugins(tmpDir);

    expect(getPluginHost().listAttached()).toHaveLength(1);
    expect(getTool("hello__echo")).toBeDefined();

    await hookDispatcher.dispatch("runStart", { userPrompt: "plugin time" });
  });
});
