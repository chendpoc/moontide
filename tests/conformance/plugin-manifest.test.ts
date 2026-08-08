import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { loadPluginManifest } from "@moontide/sidecar-host";
import type { PluginAttach, PluginKind, SidecarTransport } from "@moontide/sidecar-host";
import { dataPath } from "@moontide/shared/utils/path.js";
import { createTmpWorkdir, removeTmpWorkdir } from "../helpers/tmp-workdir.js";

const VALID_KINDS = new Set<PluginKind>(["mcp", "sidecar", "wasm"]);
const VALID_ATTACH = new Set<PluginAttach>(["startup", "runtime", "manual"]);
const VALID_TRANSPORT = new Set<SidecarTransport>(["stdio", "in-process"]);

describe("plugin manifest conformance", () => {
  it("returns empty manifest when no plugins file exists", () => {
    const tmpDir = createTmpWorkdir("moontide-plugin-manifest-");
    try {
      expect(loadPluginManifest(tmpDir)).toEqual({ plugins: [] });
    } finally {
      removeTmpWorkdir(tmpDir);
    }
  });

  it("parses plugins.toml sidecar entries", () => {
    const tmpDir = createTmpWorkdir("moontide-plugin-manifest-");
    try {
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
    } finally {
      removeTmpWorkdir(tmpDir);
    }
  });

  it("prefers plugins.json over plugins.toml", () => {
    const tmpDir = createTmpWorkdir("moontide-plugin-manifest-");
    try {
      fs.mkdirSync(dataPath(tmpDir), { recursive: true });
      fs.writeFileSync(
        dataPath(tmpDir, "plugins.toml"),
        `[[plugins]]
id = "from-toml"
kind = "sidecar"
attach = "startup"
`,
        "utf8",
      );
      fs.writeFileSync(
        dataPath(tmpDir, "plugins.json"),
        JSON.stringify({
          plugins: [{ id: "from-json", kind: "sidecar", attach: "startup" }],
        }),
        "utf8",
      );

      const manifest = loadPluginManifest(tmpDir);
      expect(manifest.plugins).toHaveLength(1);
      expect(manifest.plugins[0]?.id).toBe("from-json");
    } finally {
      removeTmpWorkdir(tmpDir);
    }
  });

  it("drops entries missing required fields", () => {
    const tmpDir = createTmpWorkdir("moontide-plugin-manifest-");
    try {
      fs.mkdirSync(dataPath(tmpDir), { recursive: true });
      fs.writeFileSync(
        dataPath(tmpDir, "plugins.json"),
        JSON.stringify({
          plugins: [
            { id: "ok", kind: "sidecar", attach: "startup" },
            { id: "missing-kind", attach: "startup" },
            { kind: "sidecar", attach: "startup" },
            null,
          ],
        }),
        "utf8",
      );

      const manifest = loadPluginManifest(tmpDir);
      expect(manifest.plugins).toHaveLength(1);
      expect(manifest.plugins[0]?.id).toBe("ok");
    } finally {
      removeTmpWorkdir(tmpDir);
    }
  });

  it("registers only known kind/attach/transport values", () => {
    const tmpDir = createTmpWorkdir("moontide-plugin-manifest-");
    try {
      fs.mkdirSync(dataPath(tmpDir), { recursive: true });
      fs.writeFileSync(
        dataPath(tmpDir, "plugins.json"),
        JSON.stringify({
          plugins: [
            {
              id: "sidecar-stdio",
              kind: "sidecar",
              attach: "startup",
              transport: "stdio",
              entry: "plugins/x.js",
            },
          ],
        }),
        "utf8",
      );

      for (const entry of loadPluginManifest(tmpDir).plugins) {
        expect(VALID_KINDS.has(entry.kind)).toBe(true);
        expect(VALID_ATTACH.has(entry.attach)).toBe(true);
        if (entry.transport) {
          expect(VALID_TRANSPORT.has(entry.transport)).toBe(true);
        }
      }
    } finally {
      removeTmpWorkdir(tmpDir);
    }
  });
});
