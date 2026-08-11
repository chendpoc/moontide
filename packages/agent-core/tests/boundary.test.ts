import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const _here = dirname(fileURLToPath(import.meta.url));
const _coreSrc = join(_here, "../src");

function _tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(..._tsFiles(path));
    } else if (name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

describe("agent-core import boundary", () => {
  it("does not import moontide harness paths", () => {
    const forbidden = [
      "packages/agent-cli/src/session/",
      "packages/agent-cli/src/context/",
      "packages/agent/src/plugins/",
      "packages/agent/src/agent/",
    ];
    for (const file of _tsFiles(_coreSrc)) {
      const text = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        expect(text, `${file} must not reference ${pattern}`).not.toContain(pattern);
      }
    }
  });
});
