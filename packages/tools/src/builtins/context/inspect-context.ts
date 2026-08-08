import { getInspectContextPort } from "../../ports/inspect-context.js";

export type InspectContextDetail = "summary" | "struct" | "breakdown" | "full";

export async function runInspectContext(
  input: Record<string, unknown>,
): Promise<string> {
  const detail = String(input.detail ?? "summary") as InspectContextDetail;
  const exact = input.exact === true || input.exact === "true";
  return getInspectContextPort().inspect(detail, exact);
}
