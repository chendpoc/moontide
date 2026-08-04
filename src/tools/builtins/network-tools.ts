import { httpFetchEnabled } from "../../config.js";
import { defineTools, type ToolSpec } from "../define-tool.js";
import type { ToolDefinition } from "../types.js";
import { TOOL_NAMES } from "../names.js";
import { runHttpFetch } from "./http-fetch.js";

const NETWORK_TOOL_SPECS: ToolSpec[] = [
  {
    name: TOOL_NAMES.HTTP_FETCH,
    description:
      "Fetch a URL over HTTP/HTTPS. Requires user approval. Prefer over bash curl/wget.",
    permission: { kind: "fixed", decision: "ask" },
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

export function defineNetworkTools(): ToolDefinition[] {
  return defineTools(NETWORK_TOOL_SPECS);
}
