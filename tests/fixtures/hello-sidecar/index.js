import { defineSidecarPlugin } from "../../../src/plugin-sdk/define.js";

export default defineSidecarPlugin({
  hooks: {
    runStart: {
      greet({ userPrompt }) {
        return {
          events: {
            turn: 0,
            phase: "pre_llm",
            channel: "trace",
            kind: "assistant_text",
            payload: { body: `sidecar saw: ${userPrompt}`, charCount: userPrompt.length },
            preview: userPrompt.slice(0, 40),
          },
        };
      },
    },
  },
  tools: {
    echo: {
      permission: { kind: "fixed", decision: "allow" },
      schema: {
        name: "echo",
        description: "Echo input text.",
        input_schema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to echo." },
          },
          required: ["text"],
        },
      },
      handler(input) {
        return String(input.text ?? "");
      },
    },
  },
});
