export const DEEP_TASK_PROTOCOL_HEADER = "## Deep Task Mode (active)";

export interface DeepTaskComposeContext {
  goal: string;
  workMemId: string;
}

/** Deep Task Protocol block — injected before Working Set snapshot. */
export function appendDeepTaskProtocolToSystem(
  systemBase: string,
  deepTask: DeepTaskComposeContext,
): string {
  const block = [
    DEEP_TASK_PROTOCOL_HEADER,
    "",
    `- **Goal:** ${deepTask.goal}`,
    `- **Work memory:** \`${deepTask.workMemId}\` — use tool \`work_mem\` for outline, notes, decisions.`,
    "- **Protocol:**",
    "  1. Keep structured state in `work_mem` (not in chat prose).",
    "  2. After meaningful reads/greps: `work_mem` action `note` with `ref` (path or toolUseId).",
    "  3. Before delivering a conclusion: `work_mem` action `draft` kind `decision`.",
    "  4. Do not store raw tool dumps in `work_mem`; reference artifacts/paths instead.",
  ].join("\n");
  return `${systemBase}\n\n${block}`;
}
