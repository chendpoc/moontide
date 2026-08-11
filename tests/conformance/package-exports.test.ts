import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  collectMoontideImportSpecifiers,
  exportImportTarget,
  listMoontidePackages,
  packageDirForName,
  resolvePackageSubpathExport,
  splitPackageSpecifier,
} from "../helpers/package-exports.js";
import { repoPath } from "../helpers/source-scan.js";

const execFileAsync = promisify(execFile);

describe("package exports (Node resolution conformance)", { timeout: 30_000 }, () => {
  it("wildcard export targets do not use *.js (NodeNext subpaths already include .js)", () => {
    const offenders: string[] = [];

    for (const pkg of listMoontidePackages()) {
      for (const [exportKey, exportValue] of Object.entries(pkg.exports)) {
        if (!exportKey.includes("*")) {
          continue;
        }
        const importTarget = exportImportTarget(exportValue);
        if (importTarget?.endsWith("*.js")) {
          offenders.push(`${pkg.name} ${exportKey} → ${importTarget}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("monorepo @moontide/* subpath imports resolve without .js.js", () => {
    const packages = listMoontidePackages();
    const offenders: string[] = [];

    for (const specifier of collectMoontideImportSpecifiers()) {
      const parts = splitPackageSpecifier(specifier);
      if (!parts) {
        continue;
      }

      const pkg = packages.find((entry) => entry.name === parts.pkgName);
      if (!pkg) {
        continue;
      }

      const resolved = resolvePackageSubpathExport(pkg.exports, parts.subpath);
      if (!resolved) {
        continue;
      }

      if (resolved.endsWith(".js.js")) {
        offenders.push(`${specifier} → ${resolved}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("built dist files exist for resolved subpath imports when dist/ is present", () => {
    const packages = listMoontidePackages();
    const missing: string[] = [];

    for (const specifier of collectMoontideImportSpecifiers()) {
      const parts = splitPackageSpecifier(specifier);
      if (!parts) {
        continue;
      }

      const pkgDir = packageDirForName(packages, parts.pkgName);
      if (!pkgDir) {
        continue;
      }

      const pkg = packages.find((entry) => entry.name === parts.pkgName)!;
      const resolved = resolvePackageSubpathExport(pkg.exports, parts.subpath);
      if (!resolved?.startsWith("dist/")) {
        continue;
      }

      const distRoot = path.join(pkgDir, "dist");
      if (!existsSync(distRoot)) {
        continue;
      }

      const filePath = path.join(pkgDir, resolved);
      if (!existsSync(filePath)) {
        missing.push(`${specifier} → ${resolved}`);
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("package exports (runtime via Node, not vitest aliases)", { timeout: 30_000 }, () => {
  const sharedDist = repoPath("packages/shared/dist/utils/text.js");
  const sessionDist = repoPath("packages/session/dist/block-registry.js");
  const runStackDist = {
    runProtocol: repoPath("packages/run-protocol/dist/index.js"),
    agentCore: repoPath("packages/agent-core/dist/index.js"),
    agent: repoPath("packages/agent/dist/index.js"),
    agentCliBootstrapEnv: repoPath("packages/agent-cli/dist/bootstrap-env.js"),
  };

  it("built dist is present for Node export runtime conformance", () => {
    expect(
      existsSync(sharedDist),
      "Run pnpm build:core before relying on Node export runtime tests",
    ).toBe(true);
    expect(existsSync(sessionDist)).toBe(true);
  });

  it("built dist is present for run stack package exports", () => {
    const missing = Object.entries(runStackDist)
      .filter(([, filePath]) => !existsSync(filePath))
      .map(([name]) => name);
    expect(
      missing,
      `Run pnpm build:core — missing dist: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("Node can import run stack dist exports (run-protocol · agent-core · agent · agent-cli/bootstrap-env)", async () => {
    const missing = Object.values(runStackDist).filter((filePath) => !existsSync(filePath));
    if (missing.length > 0) {
      return;
    }

    const script = `
      import { PROTOCOL_VERSION } from "@moontide/run-protocol";
      import { createRunEventBus } from "@moontide/agent-core";
      import { createAgentRuntime, loadWorkspaceEnv } from "@moontide/agent";
      import { loadBootstrapEnv } from "@moontide/agent-cli/bootstrap-env";
      if (PROTOCOL_VERSION !== 2) process.exit(2);
      if (typeof createRunEventBus !== "function") process.exit(3);
      if (typeof createAgentRuntime !== "function") process.exit(4);
      if (typeof loadWorkspaceEnv !== "function") process.exit(5);
      if (typeof loadBootstrapEnv !== "function") process.exit(6);
      console.log("ok");
    `;

    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: repoPath("packages/agent-cli"),
      env: process.env,
    });

    expect(stdout.trim()).toBe("ok");
  });

  it("Node can import shared subpath and session/block-registry (dev startup chain)", async () => {
    expect(existsSync(sharedDist)).toBe(true);

    const script = `
      import { truncateOneLine } from "@moontide/shared/utils/text.js";
      import { estimateJsonTokens, estimateTextTokens } from "@moontide/session/block-registry";
      if (typeof truncateOneLine !== "function") process.exit(2);
      if (typeof estimateJsonTokens !== "function") process.exit(3);
      if (typeof estimateTextTokens !== "function") process.exit(4);
      console.log("ok");
    `;

    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: repoPath("packages/agent-cli"),
      env: process.env,
    });

    expect(stdout.trim()).toBe("ok");
  });

  it("tsx dev tsconfig resolves session/block-registry (not empty re-export)", async () => {
    const scriptPath = repoPath("tests/fixtures/tsx-block-registry-import.mts");
    const tsxBin = repoPath("node_modules/.bin/tsx");
    const { stdout } = await execFileAsync(
      tsxBin,
      ["--tsconfig", "../../tsconfig.dev.json", scriptPath],
      { cwd: repoPath("packages/agent-cli"), env: process.env, timeout: 15_000 },
    );
    expect(stdout.trim()).toBe("ok");
  });

  it("tsx dev tsconfig resolves shared/utils/text.js (wildcard export chain)", async () => {
    const scriptPath = repoPath("tests/fixtures/tsx-shared-text-import.mts");
    const tsxBin = repoPath("node_modules/.bin/tsx");
    const { stdout } = await execFileAsync(
      tsxBin,
      ["--tsconfig", "../../tsconfig.dev.json", scriptPath],
      { cwd: repoPath("packages/agent-cli"), env: process.env, timeout: 15_000 },
    );
    expect(stdout.trim()).toBe("ok");
  });
});
