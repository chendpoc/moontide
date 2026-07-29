import { registerTool } from "./registry.js";
import { runEdit, runGlob, runRead, runWrite } from "./fs.js";
import { runBash } from "./bash.js";

registerTool({
  schema: {
    name: "bash",
    description: "Run a shell command in the workspace.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  handler: (input) => runBash(String(input.command ?? "")),
});

registerTool({
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
  handler: (input) =>
    runRead(String(input.path ?? ""), input.limit === undefined ? undefined : Number(input.limit)),
});

registerTool({
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
  handler: (input) => runWrite(String(input.path ?? ""), String(input.content ?? "")),
});

registerTool({
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
  handler: (input) =>
    runEdit(String(input.path ?? ""), String(input.old_text ?? ""), String(input.new_text ?? "")),
});

registerTool({
  schema: {
    name: "glob",
    description: "Find files matching a glob pattern in the workspace.",
    input_schema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
  handler: (input) => runGlob(String(input.pattern ?? "")),
});
