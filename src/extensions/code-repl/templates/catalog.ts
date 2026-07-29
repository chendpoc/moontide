export type TemplateVarType = "string" | "number" | "boolean";

export interface TemplateVarDef {
  name: string;
  type: TemplateVarType;
  required?: boolean;
  default?: string | number | boolean;
  /** When true, value is validated with safePath (workspace-relative). */
  path?: boolean;
  description?: string;
}

export interface TemplateDef {
  id: string;
  runtime: string;
  description: string;
  bodyFile: string;
  vars: TemplateVarDef[];
}

export const TEMPLATE_CATALOG: TemplateDef[] = [
  {
    id: "read_json",
    runtime: "tsx",
    description: "Read a JSON file and return top-level keys plus a depth-limited preview.",
    bodyFile: "tsx/read_json.ts",
    vars: [
      { name: "path", type: "string", required: true, path: true },
      { name: "max_depth", type: "number", default: 2, description: "Preview nesting depth" },
    ],
  },
  {
    id: "jsonl_tail",
    runtime: "tsx",
    description: "Read the last N lines of a JSONL file and parse each line as JSON.",
    bodyFile: "tsx/jsonl_tail.ts",
    vars: [
      { name: "path", type: "string", required: true, path: true },
      { name: "n", type: "number", default: 10, description: "Number of trailing lines" },
    ],
  },
  {
    id: "package_scripts",
    runtime: "tsx",
    description: "Summarize package.json name, scripts, and dependencies.",
    bodyFile: "tsx/package_scripts.ts",
    vars: [{ name: "path", type: "string", default: "package.json", path: true }],
  },
  {
    id: "glob_stats",
    runtime: "tsx",
    description: "Count files and bytes grouped by extension under the workspace.",
    bodyFile: "tsx/glob_stats.ts",
    vars: [
      { name: "dir", type: "string", default: ".", path: true },
      { name: "max_files", type: "number", default: 5000 },
    ],
  },
  {
    id: "git_summary",
    runtime: "bash",
    description: "Git status, recent log, and diff --stat (read-only).",
    bodyFile: "bash/git_summary.sh",
    vars: [{ name: "log_n", type: "number", default: 5 }],
  },
  {
    id: "env_check",
    runtime: "tsx",
    description: "Probe node, python, tsx, pnpm availability and versions in the workspace.",
    bodyFile: "tsx/env_check.ts",
    vars: [],
  },
  {
    id: "json_pretty",
    runtime: "python",
    description: "Pretty-print JSON from a file or inline text string.",
    bodyFile: "python/json_pretty.py",
    vars: [
      { name: "path", type: "string", path: true, description: "Workspace-relative JSON file" },
      { name: "text", type: "string", description: "Inline JSON string (if path omitted)" },
      { name: "max_chars", type: "number", default: 20_000 },
    ],
  },
  {
    id: "peek_csv",
    runtime: "python",
    description: "Peek CSV columns and first N rows (stdlib csv).",
    bodyFile: "python/peek_csv.py",
    vars: [
      { name: "path", type: "string", required: true, path: true },
      { name: "n", type: "number", default: 5, description: "Sample row count" },
    ],
  },
];

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATE_CATALOG.find((t) => t.id === id);
}

export function listTemplateIds(): string[] {
  return TEMPLATE_CATALOG.map((t) => t.id);
}

export function templateDescriptions(): string {
  return TEMPLATE_CATALOG.map((t) => `- ${t.id} (${t.runtime}): ${t.description}`).join("\n");
}
