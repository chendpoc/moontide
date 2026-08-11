import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";

import {
  diffDevAndVitestAliases,
  listTsconfigDevPathKeys,
  listVitestAliasEntries,
  sharedWildcardPathCount,
} from "../helpers/dev-alias-sync.js";
import {
  findWorkspaceRoot,
  loadBootstrapEnv,
} from "../../packages/agent-cli/src/bootstrap-env.js";
import { repoPath } from "../helpers/source-scan.js";
import { createTmpWorkdir, removeTmpWorkdir } from "../helpers/tmp-workdir.js";

const execFileAsync = promisify(execFile);
const tsxBin = repoPath("node_modules/.bin/tsx");
const tsconfigDev = "../../tsconfig.dev.json";
const appCwd = repoPath("packages/agent-cli");

async function runTsxFixture(
  scriptPath: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = {},
  options?: { tsconfig?: string | false; cwd?: string },
): Promise<string> {
  const tsconfig = options?.tsconfig;
  const argv =
    tsconfig === false
      ? [scriptPath, ...args]
      : ["--tsconfig", tsconfig ?? tsconfigDev, scriptPath, ...args];

  const { stdout } = await execFileAsync(tsxBin, argv, {
    cwd: options?.cwd ?? appCwd,
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
  return stdout.trim();
}

describe("dev startup (bootstrap env)", () => {
  let tmpRoot = "";
  const savedEnv: Record<string, string | undefined> = {};

  function saveEnv(keys: string[]): void {
    for (const key of keys) {
      savedEnv[key] = process.env[key];
    }
  }

  function restoreEnv(keys: string[]): void {
    for (const key of keys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  }

  afterEach(() => {
    if (tmpRoot) {
      removeTmpWorkdir(tmpRoot);
      tmpRoot = "";
    }
    restoreEnv([
      "MOONTIDE_WORKDIR",
      "DEEPSEEK_API_KEY",
      "MOONTIDE_DEV_BOOTSTRAP_PROBE",
      "ANTHROPIC_API_KEY",
    ]);
  });

  it("findWorkspaceRoot stops at pnpm-workspace.yaml", () => {
    tmpRoot = createTmpWorkdir("moontide-bootstrap-");
    writeFileSync(path.join(tmpRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    const nested = path.join(tmpRoot, "packages", "agent-cli", "src");
    mkdirSync(nested, { recursive: true });

    expect(findWorkspaceRoot(nested)).toBe(tmpRoot);
  });

  it("findWorkspaceRoot falls back to start when no workspace marker", () => {
    tmpRoot = createTmpWorkdir("moontide-bootstrap-");
    const leaf = path.join(tmpRoot, "orphan", "deep");
    mkdirSync(leaf, { recursive: true });

    expect(findWorkspaceRoot(leaf)).toBe(leaf);
  });

  it("loadBootstrapEnv reads workspace root .env and defaults MOONTIDE_WORKDIR", () => {
    tmpRoot = createTmpWorkdir("moontide-bootstrap-");
    writeFileSync(path.join(tmpRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    writeFileSync(
      path.join(tmpRoot, ".env"),
      "MOONTIDE_DEV_BOOTSTRAP_PROBE=from-root\nDEEPSEEK_API_KEY=sk-root\n",
    );
    const appRoot = path.join(tmpRoot, "packages", "agent-cli");
    mkdirSync(appRoot, { recursive: true });

    saveEnv(["MOONTIDE_WORKDIR", "DEEPSEEK_API_KEY", "MOONTIDE_DEV_BOOTSTRAP_PROBE"]);
    delete process.env.MOONTIDE_WORKDIR;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.MOONTIDE_DEV_BOOTSTRAP_PROBE;

    const { workspaceRoot } = loadBootstrapEnv(appRoot);

    expect(workspaceRoot).toBe(tmpRoot);
    expect(process.env.MOONTIDE_DEV_BOOTSTRAP_PROBE).toBe("from-root");
    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-root");
    expect(process.env.MOONTIDE_WORKDIR).toBe(tmpRoot);
  });

  it("app .env overrides workspace root .env", () => {
    tmpRoot = createTmpWorkdir("moontide-bootstrap-");
    writeFileSync(path.join(tmpRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    writeFileSync(path.join(tmpRoot, ".env"), "DEEPSEEK_API_KEY=sk-root\n");
    const appRoot = path.join(tmpRoot, "packages", "agent-cli");
    mkdirSync(appRoot, { recursive: true });
    writeFileSync(path.join(appRoot, ".env"), "DEEPSEEK_API_KEY=sk-app\n");

    saveEnv(["DEEPSEEK_API_KEY", "MOONTIDE_WORKDIR"]);
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.MOONTIDE_WORKDIR;

    loadBootstrapEnv(appRoot);

    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-app");
  });

  it("loads app .env when workspace root has no .env", () => {
    tmpRoot = createTmpWorkdir("moontide-bootstrap-");
    writeFileSync(path.join(tmpRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    const appRoot = path.join(tmpRoot, "packages", "agent-cli");
    mkdirSync(appRoot, { recursive: true });
    writeFileSync(path.join(appRoot, ".env"), "DEEPSEEK_API_KEY=sk-app-only\n");

    saveEnv(["DEEPSEEK_API_KEY", "MOONTIDE_WORKDIR"]);
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.MOONTIDE_WORKDIR;

    loadBootstrapEnv(appRoot);

    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-app-only");
  });

  it("does not override MOONTIDE_WORKDIR when already set", () => {
    tmpRoot = createTmpWorkdir("moontide-bootstrap-");
    writeFileSync(path.join(tmpRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    const appRoot = path.join(tmpRoot, "packages", "agent-cli");
    mkdirSync(appRoot, { recursive: true });
    const preset = path.join(tmpRoot, "preset-workdir");

    saveEnv(["MOONTIDE_WORKDIR"]);
    process.env.MOONTIDE_WORKDIR = preset;

    loadBootstrapEnv(appRoot);

    expect(process.env.MOONTIDE_WORKDIR).toBe(preset);
  });

  it("does not default MOONTIDE_WORKDIR when appRoot is not packages/agent-cli", () => {
    tmpRoot = createTmpWorkdir("moontide-bootstrap-");
    writeFileSync(path.join(tmpRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    const appRoot = path.join(tmpRoot, "packages", "other");
    mkdirSync(appRoot, { recursive: true });

    saveEnv(["MOONTIDE_WORKDIR"]);
    delete process.env.MOONTIDE_WORKDIR;

    loadBootstrapEnv(appRoot);

    expect(process.env.MOONTIDE_WORKDIR).toBeUndefined();
  });
});

describe("dev startup (runtime via tsx, not vitest aliases)", { timeout: 60_000 }, () => {
  it("bootstrap import order: getWorkdir resolves to workspace root", async () => {
    const stdout = await runTsxFixture(repoPath("tests/fixtures/dev-bootstrap-workdir.mts"), [], {
      MOONTIDE_WORKDIR: "",
    });
    expect(stdout).toBe(repoPath());
  });

  it("dev tsconfig resolves bootstrap + tools + llm route", async () => {
    const stdout = await runTsxFixture(repoPath("tests/fixtures/dev-startup-smoke.mts"), [], {
      DEEPSEEK_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      MOONTIDE_WORKDIR: "",
    });
    expect(stdout).toBe("ok");
  });

  it("tsx dev tsconfig resolves @moontide/shared/utils/text.js", async () => {
    const stdout = await runTsxFixture(repoPath("tests/fixtures/tsx-shared-text-import.mts"));
    expect(stdout).toBe("ok");
  });

  it("setupToolsPorts must run before createAgentRuntime", async () => {
    const scriptPath = repoPath("tests/fixtures/dev-tools-init-order.mts");
    expect(await runTsxFixture(scriptPath, ["wrong-order"])).toBe("expected-failure");
    expect(await runTsxFixture(scriptPath, ["correct-order"])).toBe("ok");
  });

  it("setupToolsPorts must run before getAgentRuntime", async () => {
    const scriptPath = repoPath("tests/fixtures/dev-tools-init-order.mts");
    expect(await runTsxFixture(scriptPath, ["wrong-order-get-runtime"])).toBe("expected-failure");
    expect(await runTsxFixture(scriptPath, ["correct-order-get-runtime"])).toBe("ok");
  });

  it("resolveRoute succeeds after loadBootstrapEnv with workspace .env", async () => {
    const routeRoot = createTmpWorkdir("moontide-resolve-route-");
    try {
      writeFileSync(path.join(routeRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
      writeFileSync(
        path.join(routeRoot, ".env"),
        "DEEPSEEK_API_KEY=sk-from-env\nMODEL_ID=deepseek-v4-pro\n",
      );
      mkdirSync(path.join(routeRoot, "packages", "agent-cli"), { recursive: true });

      const stdout = await runTsxFixture(
        repoPath("tests/fixtures/dev-resolve-route.mts"),
        ["with-env", routeRoot],
        { DEEPSEEK_API_KEY: "", ANTHROPIC_API_KEY: "" },
      );
      expect(stdout).toBe("ok");
    } finally {
      removeTmpWorkdir(routeRoot);
    }
  });

  it("resolveRoute fails when bootstrap finds no API keys", async () => {
    const routeRoot = createTmpWorkdir("moontide-resolve-route-");
    try {
      writeFileSync(path.join(routeRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
      mkdirSync(path.join(routeRoot, "packages", "agent-cli"), { recursive: true });

      const stdout = await runTsxFixture(
        repoPath("tests/fixtures/dev-resolve-route.mts"),
        ["no-key", routeRoot],
        { DEEPSEEK_API_KEY: "", ANTHROPIC_API_KEY: "" },
      );
      expect(stdout).toBe("expected-failure");
    } finally {
      removeTmpWorkdir(routeRoot);
    }
  });

  it("cold start runAgent completes one turn with mock LLM", async () => {
    const workdir = createTmpWorkdir("moontide-cold-start-");
    try {
      const stdout = await runTsxFixture(
        repoPath("tests/fixtures/cold-start-run-agent.mts"),
        [workdir],
        { MOONTIDE_WORKDIR: workdir },
      );
      expect(stdout).toBe("ok");
    } finally {
      removeTmpWorkdir(workdir);
    }
  });
});

describe("dev alias sync (tsconfig.dev.json vs vitest.config.ts)", () => {
  it("non-wildcard path keys match between dev tsconfig and vitest aliases", async () => {
    const tsconfigKeys = listTsconfigDevPathKeys();
    const vitestEntries = await listVitestAliasEntries();
    const { missingInVitest, missingInTsconfig } = diffDevAndVitestAliases(
      tsconfigKeys,
      vitestEntries,
    );

    expect(missingInVitest, `tsconfig keys missing in vitest: ${missingInVitest.join(", ")}`).toEqual(
      [],
    );
    expect(
      missingInTsconfig,
      `vitest aliases missing in tsconfig: ${missingInTsconfig.join(", ")}`,
    ).toEqual([]);
  });

  it("shared subpath wildcards in tsconfig are covered by vitest regex alias", async () => {
    const tsconfigKeys = listTsconfigDevPathKeys();
    const vitestEntries = await listVitestAliasEntries();

    expect(sharedWildcardPathCount(tsconfigKeys)).toBe(4);
    expect(
      vitestEntries.some((entry) => entry.isRegex && entry.find.includes("@moontide\\/shared\\/")),
    ).toBe(true);
  });
});

describe("production start (compiled dist, not tsx dev paths)", { timeout: 30_000 }, () => {
  const distBootstrap = repoPath("packages/agent-cli/dist/bootstrap.js");

  it.skipIf(!existsSync(distBootstrap))(
    "compiled bootstrap + tools + llm route via package exports",
    async () => {
      const script = `
        process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? "sk-prod-smoke";
        await import("./dist/bootstrap.js");
        const { setupToolsPorts, getAgentRuntime } = await import("@moontide/agent");
        const { resolveRoute } = await import("@moontide/llm");
        setupToolsPorts();
        const runtime = getAgentRuntime();
        if (!runtime.tools.getTool("read_file")) process.exit(2);
        const route = resolveRoute();
        if (route.providerPresetId !== "deepseek") process.exit(3);
        console.log("ok");
      `;

      const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: repoPath("packages/agent-cli"),
        env: {
          ...process.env,
          DEEPSEEK_API_KEY: "sk-prod-smoke",
          MOONTIDE_WORKDIR: repoPath(),
        },
        timeout: 15_000,
      });

      expect(stdout.trim()).toBe("ok");
    },
  );

  it("requires packages/agent-cli/dist for production smoke (run pnpm build)", () => {
    if (existsSync(distBootstrap)) {
      expect(existsSync(repoPath("packages/agent-cli/dist/main.js"))).toBe(true);
      return;
    }
    expect(existsSync(distBootstrap)).toBe(true);
  });
});

describe("vitest setup (bootstrap side effect)", () => {
  it("tests/setup.ts loads bootstrap before app modules (getWorkdir is absolute)", async () => {
    const { getWorkdir } = await import("../../packages/agent/src/config.js");
    expect(path.isAbsolute(getWorkdir())).toBe(true);
  });
});
