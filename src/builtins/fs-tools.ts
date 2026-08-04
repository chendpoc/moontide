import { httpFetchEnabled } from "../config.js";
import { defineTools, type ToolSpec } from "../tools/define-tool.js";
import type { ToolDefinition } from "../tools/types.js";
import { TOOL_NAMES } from "../tools/names.js";
import { runEdit, runGlob, runListDir, runRead, runWrite } from "./fs.js";
import { runBash } from "./bash.js";
import { runGrep } from "./grep.js";
import { runHttpFetch } from "./http-fetch.js";

const FS_TOOL_SPECS: ToolSpec[] = [
  {
    name: TOOL_NAMES.BASH,
    description: "Run a shell command in the workspace.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
    run: (input) => runBash(String(input.command ?? "")),
  },
  {
    name: TOOL_NAMES.READ_FILE,
    description: "Read a file relative to the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        limit: { type: "integer", description: "Maximum number of lines to return." },
        offset: { type: "integer", description: "1-based starting line (default 1)." },
      },
      required: ["path"],
    },
    run: (input) => {
      const limit = input.limit === undefined ? undefined : Number(input.limit);
      const offset = input.offset === undefined ? 1 : Number(input.offset);
      return runRead(String(input.path ?? ""), limit, offset);
    },
  },
  {
    name: TOOL_NAMES.WRITE_FILE,
    description: "Write content to a file relative to the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    run: (input) => runWrite(String(input.path ?? ""), String(input.content ?? "")),
  },
  {
    name: TOOL_NAMES.EDIT_FILE,
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
    run: (input) =>
      runEdit(String(input.path ?? ""), String(input.old_text ?? ""), String(input.new_text ?? "")),
  },
  {
    name: TOOL_NAMES.GLOB,
    description: "Find files matching a glob pattern in the workspace.",
    input_schema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
    run: (input) => runGlob(String(input.pattern ?? "")),
  },
  {
    name: TOOL_NAMES.LIST_DIR,
    description: "List files and directories under a workspace path.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path (default .)." },
        recursive: {
          type: "boolean",
          description: "Recurse up to depth 2 (default false).",
        },
      },
    },
    run: (input) =>
      runListDir(input.path === undefined ? "." : String(input.path), input.recursive === true),
  },
  {
    name: TOOL_NAMES.GREP,
    description:
      "Search code in the workspace with ripgrep (rg) or grep. Prefer over bash for code search.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for." },
        path: { type: "string", description: "Relative path to search (default .)." },
        glob: { type: "string", description: "Optional file glob filter, e.g. *.ts." },
        max_results: { type: "integer", description: "Max matches (default 50, cap 200)." },
        case_insensitive: { type: "boolean" },
      },
      required: ["pattern"],
    },
    run: (input) =>
      runGrep({
        pattern: String(input.pattern ?? ""),
        path: input.path === undefined ? undefined : String(input.path),
        glob: input.glob === undefined ? undefined : String(input.glob),
        max_results: input.max_results === undefined ? undefined : Number(input.max_results),
        case_insensitive: input.case_insensitive === true,
      }),
  },
  {
    name: TOOL_NAMES.HTTP_FETCH,
    description:
      "Fetch a URL over HTTP/HTTPS. Requires user approval. Prefer over bash curl/wget.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        },
        headers: { type: "object", additionalProperties: { type: "string" } },
        body: { type: "string" },
        max_bytes: { type: "integer" },
        timeout_ms: { type: "integer" },
      },
      required: ["url"],
    },
    enabled: httpFetchEnabled,
    run: (input) =>
      runHttpFetch({
        url: String(input.url ?? ""),
        method: input.method === undefined ? undefined : String(input.method),
        headers:
          input.headers && typeof input.headers === "object"
            ? (input.headers as Record<string, string>)
            : undefined,
        body: input.body === undefined ? undefined : String(input.body),
        max_bytes: input.max_bytes === undefined ? undefined : Number(input.max_bytes),
        timeout_ms: input.timeout_ms === undefined ? undefined : Number(input.timeout_ms),
      }),
  },
];

export function defineBuiltinFsTools(): ToolDefinition[] {
  return defineTools(FS_TOOL_SPECS);
}
