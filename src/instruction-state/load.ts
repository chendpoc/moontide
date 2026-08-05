import { globFiles } from "../utils/glob.js";
import { exists, readTextIfExists } from "../utils/fs.js";
import { dataPath, joinPath } from "../utils/path.js";

const PROJECT_INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

/** Load AGENTS.md / CLAUDE.md and workspace data-dir rules/*.md (first file wins per name). */
export function loadProjectRules(workdir: string): string {
  const parts: string[] = [];

  for (const name of PROJECT_INSTRUCTION_FILES) {
    const filePath = joinPath(workdir, name);
    const text = readTextIfExists(filePath)?.trim();
    if (text) {
      parts.push(text);
    }
  }

  const rulesDir = dataPath(workdir, "rules");
  if (exists(rulesDir)) {
    const ruleFiles = globFiles("*.md", { cwd: rulesDir, absolute: true }).sort();
    for (const filePath of ruleFiles) {
      const text = readTextIfExists(filePath)?.trim();
      if (text) {
        parts.push(text);
      }
    }
  }

  return parts.join("\n\n");
}
