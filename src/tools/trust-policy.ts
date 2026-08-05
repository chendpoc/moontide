import type { PermissionDecision } from "./types.js";

export type TrustPolicy = "ask" | "always";

/** Merge session trust with per-tool permission; deny always wins. */
export function effectiveDecision(
  toolDecision: PermissionDecision,
  policy: TrustPolicy,
): PermissionDecision {
  if (toolDecision === "deny") {
    return "deny";
  }
  if (toolDecision === "allow") {
    return "allow";
  }
  return policy === "always" ? "allow" : "ask";
}
