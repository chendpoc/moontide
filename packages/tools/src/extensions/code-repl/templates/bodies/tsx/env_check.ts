import { execFileSync } from "node:child_process";

/*__VARS__*/

function toMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function probe(cmd: string, args: string[]): { available: boolean; version?: string; error?: string } {
  try {
    const out = execFileSync(cmd, args, { encoding: "utf8", timeout: 5000 }).trim();
    const firstLine = out.split("\n")[0] ?? out;
    return { available: true, version: firstLine };
  } catch (error) {
    return {
      available: false,
      error: toMessage(error),
    };
  }
}

const workdir = process.cwd();
const result = {
  workdir,
  node: probe("node", ["--version"]),
  python: probe("python3", ["--version"]),
  tsx: probe("tsx", ["--version"]),
  pnpm: probe("pnpm", ["--version"]),
};

console.log(JSON.stringify(result));
