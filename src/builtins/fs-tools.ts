import type { ToolDefinition } from "../toolkit/types.js";
import { runEdit, runGlob, runRead, runWrite } from "./fs.js";
import { runBash } from "./bash.js";

export function defineBuiltinFsTools(): ToolDefinition[] {
  return [
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
            limit: { type: "integer" },
          },
          required: ["path"],
        },
      },
      handler: (input, _ctx) =>
        runRead(String(input.path ?? ""), input.limit === undefined ? undefined : Number(input.limit)),
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
  ];
}
