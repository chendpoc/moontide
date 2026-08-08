import { defineTools, type ToolSpec } from "../../define-tool.js";
import type { ToolDefinition } from "../../types.js";
import { TOOL_NAMES } from "../../names.js";
import { runEdit, runGlob, runListDir, runRead, runWrite } from "./fs.js";

const WORKSPACE_TOOL_SPECS: ToolSpec[] = [
  {
    name: TOOL_NAMES.READ_FILE,
    description: "Read a file relative to the workspace.",
    permission: { kind: "path", field: "path" },
    capability: "read",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        limit: { type: "integer", description: "Maximum number of lines to return." },
        offset: { type: "integer", description: "1-based starting line (default 1)." },
      },
      required: ["path"],
    },
    run: (input, ctx) => {
      const limit = input.limit === undefined ? undefined : Number(input.limit);
      const offset = input.offset === undefined ? 1 : Number(input.offset);
      return runRead(ctx.workdir, String(input.path ?? ""), limit, offset);
    },
  },
  {
    name: TOOL_NAMES.WRITE_FILE,
    description: "Write content to a file relative to the workspace.",
    permission: { kind: "path", field: "path" },
    capability: "write",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    run: (input, ctx) =>
      runWrite(ctx.workdir, String(input.path ?? ""), String(input.content ?? "")),
  },
  {
    name: TOOL_NAMES.EDIT_FILE,
    description: "Replace the first exact occurrence of old_text in a file.",
    permission: { kind: "path", field: "path" },
    capability: "write",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
      },
      required: ["path", "old_text", "new_text"],
    },
    run: (input, ctx) =>
      runEdit(
        ctx.workdir,
        String(input.path ?? ""),
        String(input.old_text ?? ""),
        String(input.new_text ?? ""),
      ),
  },
  {
    name: TOOL_NAMES.GLOB,
    description: "Find files matching a glob pattern in the workspace.",
    permission: { kind: "fixed", decision: "allow" },
    capability: "read",
    input_schema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
    run: (input, ctx) => runGlob(ctx.workdir, String(input.pattern ?? "")),
  },
  {
    name: TOOL_NAMES.LIST_DIR,
    description: "List files and directories under a workspace path.",
    permission: { kind: "path", field: "path" },
    capability: "read",
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
    run: (input, ctx) =>
      runListDir(
        ctx.workdir,
        input.path === undefined ? "." : String(input.path),
        input.recursive === true,
      ),
  },
];

export function defineWorkspaceTools(): ToolDefinition[] {
  return defineTools(WORKSPACE_TOOL_SPECS);
}
