import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { globSync } from "glob";
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { getWorkdir, setWorkdir } from "./config.js";

const execAsync = promisify(exec);

export { setWorkdir };

const DENY_PATTERNS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];

type ToolHandler = (input: Record<string, unknown>) => string | Promise<string>;

export function safePath(relative: string): string {
  const workdir = getWorkdir();
  const resolved = path.resolve(workdir, relative);
  const rel = path.relative(workdir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${relative}`);
  }
  return resolved;
}

export async function runBash(command: string): Promise<string> {
  for (const pattern of DENY_PATTERNS) {
    if (command.includes(pattern)) {
      return `Error: blocked: ${command}`;
    }
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: getWorkdir(),
      timeout: 120_000,
      maxBuffer: 50_000,
      encoding: "utf8",
      shell: "/bin/bash",
    });
    const output = `${stdout}${stderr}`.trim();
    return output || "(no output)";
  } catch (error) {
    if (error instanceof Error) {
      const execError = error as Error & { killed?: boolean; signal?: string };
      if (execError.killed || execError.signal === "SIGTERM") {
        return "Error: timeout (120s)";
      }
      const stdout = "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
      const stderr = "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";
      const combined = `${stdout}${stderr}`.trim();
      if (combined) {
        return combined.slice(0, 50_000);
      }
      return `Error: ${error.message}`;
    }
    return `Error: ${String(error)}`;
  }
}

export function runRead(filePath: string, limit?: number): string {
  try {
    const lines = fs.readFileSync(safePath(filePath), "utf8").split("\n");
    if (limit !== undefined && limit < lines.length) {
      return [...lines.slice(0, limit), `... (${lines.length - limit} more lines)`].join("\n");
    }
    return lines.join("\n");
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function runWrite(filePath: string, content: string): string {
  try {
    const resolved = safePath(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, "utf8");
    return `Wrote ${content.length} bytes to ${filePath}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function runEdit(filePath: string, oldText: string, newText: string): string {
  try {
    const resolved = safePath(filePath);
    const text = fs.readFileSync(resolved, "utf8");
    if (!text.includes(oldText)) {
      return `Error: text not found in ${filePath}`;
    }
    const index = text.indexOf(oldText);
    const updated = text.slice(0, index) + newText + text.slice(index + oldText.length);
    fs.writeFileSync(resolved, updated, "utf8");
    return `Edited ${filePath}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function runGlob(pattern: string): string {
  try {
    const workdir = getWorkdir();
    const matches = globSync(pattern, { cwd: workdir, nodir: true }).filter((match) => {
      const resolved = path.resolve(workdir, match);
      const rel = path.relative(workdir, resolved);
      return !rel.startsWith("..") && !path.isAbsolute(rel);
    });
    return matches.length > 0 ? matches.join("\n") : "(no matches)";
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export const TOOL_SCHEMAS: Tool[] = [
  {
    name: "bash",
    description: "Run a shell command in the workspace.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a file relative to the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file relative to the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace the first exact occurrence of old_text in a file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern in the workspace.",
    input_schema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
];

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  bash: (input) => runBash(String(input.command ?? "")),
  read_file: (input) =>
    runRead(String(input.path ?? ""), input.limit === undefined ? undefined : Number(input.limit)),
  write_file: (input) => runWrite(String(input.path ?? ""), String(input.content ?? "")),
  edit_file: (input) =>
    runEdit(String(input.path ?? ""), String(input.old_text ?? ""), String(input.new_text ?? "")),
  glob: (input) => runGlob(String(input.pattern ?? "")),
};

export async function executeTool(
  name: string,
  toolInput: Record<string, unknown>,
): Promise<string> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return `Error: unknown tool ${name}`;
  }
  return handler(toolInput);
}
