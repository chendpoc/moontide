/** Canonical tool names — keep in sync with tool definitions and permission rules. */
export const TOOL_NAMES = {
  BASH: "bash",
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  EDIT_FILE: "edit_file",
  GLOB: "glob",
  LIST_DIR: "list_dir",
  GREP: "grep",
  HTTP_FETCH: "http_fetch",
  GIT_STATUS: "git_status",
  GIT_DIFF: "git_diff",
  GIT_LOG: "git_log",
  GIT_SUMMARY: "git_summary",
  INSPECT_CONTEXT: "inspect_context",
  ASK_USER_QUESTION: "askUserQuestion",
  CODE_REPL: "code_repl",
  DEEP_RESEARCH: "deep_research",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];
