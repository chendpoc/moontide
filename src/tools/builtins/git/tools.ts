import { defineTools, type ToolSpec } from "../../define-tool.js";
import type { ToolDefinition } from "../../types.js";
import { TOOL_NAMES } from "../../names.js";
import { runGitDiff, runGitLog, runGitStatus, runGitSummaryLink } from "./lib.js";

const GIT_TOOL_SPECS: ToolSpec[] = [
  {
    name: TOOL_NAMES.GIT_STATUS,
    description: "Read-only git status for the workspace. Prefer over bash git status.",
    permission: { kind: "fixed", decision: "allow" },
    capability: "read",
    input_schema: { type: "object", properties: {} },
    run: () => runGitStatus(),
  },
  {
    name: TOOL_NAMES.GIT_DIFF,
    description: "Read-only git diff (default --stat). Prefer over bash git diff.",
    permission: { kind: "path", field: "path" },
    capability: "read",
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
    run: (input) =>
      runGitDiff({
        stat: input.stat === undefined ? undefined : input.stat === true,
        path: input.path === undefined ? undefined : String(input.path),
        staged: input.staged === true,
        max_lines: input.max_lines === undefined ? undefined : Number(input.max_lines),
      }),
  },
  {
    name: TOOL_NAMES.GIT_LOG,
    description: "Read-only git log (oneline). Prefer over bash git log.",
    permission: { kind: "path", field: "path" },
    capability: "read",
    input_schema: {
      type: "object",
      properties: {
        n: { type: "integer", description: "Number of commits (default 10, cap 50)." },
        path: { type: "string", description: "Limit log to a workspace-relative path." },
        oneline: { type: "boolean", description: "One line per commit (default true)." },
      },
    },
    run: (input) =>
      runGitLog({
        n: input.n === undefined ? undefined : Number(input.n),
        path: input.path === undefined ? undefined : String(input.path),
        oneline: input.oneline === undefined ? undefined : input.oneline === true,
      }),
  },
  {
    name: TOOL_NAMES.GIT_SUMMARY,
    description:
      "Combined git overview (status + log + diff --stat). Does not run git directly — returns code_repl template git_summary invocation. Implementation: templates/bodies/bash/git_summary.sh.",
    permission: { kind: "fixed", decision: "allow" },
    capability: "read",
    input_schema: {
      type: "object",
      properties: {
        log_n: {
          type: "integer",
          description: "Recent commits for the summary log section (default 5).",
        },
      },
    },
    run: (input) => runGitSummaryLink(input.log_n === undefined ? undefined : Number(input.log_n)),
  },
];

export function defineGitTools(): ToolDefinition[] {
  return defineTools(GIT_TOOL_SPECS);
}
