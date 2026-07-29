import { httpFetchEnabled } from "../config.js";
import type { ToolDefinition } from "../toolkit/types.js";
import { runEdit, runGlob, runListDir, runRead, runWrite } from "./fs.js";
import { runBash } from "./bash.js";
import { runGitDiff, runGitLog, runGitStatus } from "./git.js";
import { runGrep } from "./grep.js";
import { runHttpFetch } from "./http-fetch.js";

export function defineBuiltinFsTools(): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      schema: {
        name: "bash",
        description: "Run a shell command in the workspace.",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
      handler: (input, _ctx) => runBash(String(input.command ?? "")),
    },
    {
      schema: {
        name: "read_file",
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
      },
      handler: (input, _ctx) => {
        const limit = input.limit === undefined ? undefined : Number(input.limit);
        const offset = input.offset === undefined ? 1 : Number(input.offset);
        return runRead(String(input.path ?? ""), limit, offset);
      },
    },
    {
      schema: {
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
      handler: (input, _ctx) => runWrite(String(input.path ?? ""), String(input.content ?? "")),
    },
    {
      schema: {
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
      handler: (input, _ctx) =>
        runEdit(String(input.path ?? ""), String(input.old_text ?? ""), String(input.new_text ?? "")),
    },
    {
      schema: {
        name: "glob",
        description: "Find files matching a glob pattern in the workspace.",
        input_schema: {
          type: "object",
          properties: { pattern: { type: "string" } },
          required: ["pattern"],
        },
      },
      handler: (input, _ctx) => runGlob(String(input.pattern ?? "")),
    },
    {
      schema: {
        name: "list_dir",
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
      },
      handler: (input, _ctx) =>
        runListDir(
          input.path === undefined ? "." : String(input.path),
          input.recursive === true,
        ),
    },
    {
      schema: {
        name: "grep",
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
      },
      handler: (input, _ctx) =>
        runGrep({
          pattern: String(input.pattern ?? ""),
          path: input.path === undefined ? undefined : String(input.path),
          glob: input.glob === undefined ? undefined : String(input.glob),
          max_results: input.max_results === undefined ? undefined : Number(input.max_results),
          case_insensitive: input.case_insensitive === true,
        }),
    },
    {
      schema: {
        name: "git_status",
        description:
          "Read-only git status for the workspace. Prefer over bash git status.",
        input_schema: {
          type: "object",
          properties: {},
        },
      },
      handler: (_input, _ctx) => runGitStatus(),
    },
    {
      schema: {
        name: "git_diff",
        description:
          "Read-only git diff (default --stat). Prefer over bash git diff.",
        input_schema: {
          type: "object",
          properties: {
            stat: {
              type: "boolean",
              description: "Use --stat summary (default true). Set false for unified diff.",
            },
            path: { type: "string", description: "Limit diff to a workspace-relative path." },
            staged: { type: "boolean", description: "Diff staged changes (--cached)." },
            max_lines: {
              type: "integer",
              description: "Context lines when stat=false (default 200, cap 500).",
            },
          },
        },
      },
      handler: (input, _ctx) =>
        runGitDiff({
          stat: input.stat === undefined ? undefined : input.stat === true,
          path: input.path === undefined ? undefined : String(input.path),
          staged: input.staged === true,
          max_lines: input.max_lines === undefined ? undefined : Number(input.max_lines),
        }),
    },
    {
      schema: {
        name: "git_log",
        description:
          "Read-only git log (oneline). Prefer over bash git log.",
        input_schema: {
          type: "object",
          properties: {
            n: { type: "integer", description: "Number of commits (default 10, cap 50)." },
            path: { type: "string", description: "Limit log to a workspace-relative path." },
            oneline: { type: "boolean", description: "One line per commit (default true)." },
          },
        },
      },
      handler: (input, _ctx) =>
        runGitLog({
          n: input.n === undefined ? undefined : Number(input.n),
          path: input.path === undefined ? undefined : String(input.path),
          oneline: input.oneline === undefined ? undefined : input.oneline === true,
        }),
    },
  ];

  if (httpFetchEnabled()) {
    tools.push({
      schema: {
        name: "http_fetch",
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
      },
      handler: (input, _ctx) =>
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
    });
  }

  return tools;
}
