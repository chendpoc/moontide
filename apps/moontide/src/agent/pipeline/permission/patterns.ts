type TextPattern = string | RegExp;
type BashDecision = "allow" | "deny" | "ask";

/** System-level deny patterns (blocklist → deny). */
export const SYSTEM_DENY_PATTERNS: readonly string[] = [
  "rm -rf /",
  "sudo",
  "shutdown",
  "reboot",
  "mkfs",
  "dd if=",
];

/** Destructive hints (blocklist → ask). */
export const DESTRUCTIVE_ASK_PATTERNS: readonly string[] = ["rm ", "> /etc/", "chmod 777"];

/** Network fetch via bash (prefer http_fetch tool). */
export const NETWORK_ASK_PATTERNS: readonly RegExp[] = [/\bcurl\b/i, /\bwget\b/i];

/** Code search via bash (prefer grep tool). */
export const GREP_ASK_PATTERNS: readonly RegExp[] = [/\brg\b/, /\bgrep\b/];

/** Read-only git via bash (prefer git_status/git_diff/git_log tools). */
export const GIT_ASK_PATTERNS: readonly RegExp[] = [/\bgit\s+(status|diff|log)\b/i];

/** Bash command rules — first matching group wins. */
const BASH_COMMAND_RULES: readonly { decision: BashDecision; patterns: readonly TextPattern[] }[] = [
  { decision: "deny", patterns: SYSTEM_DENY_PATTERNS },
  {
    decision: "ask",
    patterns: [
      ...NETWORK_ASK_PATTERNS,
      ...GREP_ASK_PATTERNS,
      ...GIT_ASK_PATTERNS,
      ...DESTRUCTIVE_ASK_PATTERNS,
    ],
  },
];

function matchesTextPattern(text: string, pattern: TextPattern): boolean {
  return typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
}

export function checkBashCommand(command: string): BashDecision {
  for (const rule of BASH_COMMAND_RULES) {
    if (rule.patterns.some((pattern) => matchesTextPattern(command, pattern))) {
      return rule.decision;
    }
  }
  return "allow";
}
