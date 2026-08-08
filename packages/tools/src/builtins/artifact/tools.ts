import { defineTools, type ToolSpec } from "../../define-tool.js";
import type { ToolDefinition } from "../../types.js";
import { TOOL_NAMES } from "../../names.js";
import { runReadArtifact } from "./read-artifact.js";

const ARTIFACT_TOOL_SPECS: ToolSpec[] = [
  {
    name: TOOL_NAMES.READ_ARTIFACT,
    description:
      "Read full stored tool output by artifact id from the current session.",
    permission: { kind: "fixed", decision: "allow" },
    capability: "read",
    input_schema: {
      type: "object",
      properties: {
        artifact_id: {
          type: "string",
          description: "Artifact id from a spilled tool result (see [artifact:…] footnote).",
        },
      },
      required: ["artifact_id"],
    },
    run: (input, ctx) => runReadArtifact(input, ctx),
  },
];

export function defineArtifactTools(): ToolDefinition[] {
  return defineTools(ARTIFACT_TOOL_SPECS);
}
