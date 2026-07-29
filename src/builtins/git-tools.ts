import type { ToolDefinition } from "../toolkit/types.js";
import { runGitDiff, runGitLog, runGitStatus, runGitSummaryLink } from "./git.js";

export function defineGitTools(): ToolDefinition[] {
  return [
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
    {
      schema: {
        name: "git_summary",
        description:
          "Combined git overview (status + log + diff --stat). Does not run git directly — returns code_repl template git_summary invocation. Implementation: templates/bodies/bash/git_summary.sh.",
        input_schema: {
          type: "object",
          properties: {
            log_n: {
              type: "integer",
              description: "Recent commits for the summary log section (default 5).",
            },
          },
        },
      },
      handler: (input, _ctx) =>
        runGitSummaryLink(input.log_n === undefined ? undefined : Number(input.log_n)),
    },
  ];
}
