import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { safePath } from "../../../builtins/fs.js";
import { getTemplate, type TemplateDef, type TemplateVarDef } from "./catalog.js";

const BODIES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "bodies");

export interface ExpandSuccess {
  runtime: string;
  code: string;
  resolvedVars: Record<string, string | number | boolean>;
}

export interface ExpandError {
  error: string;
  template?: string;
  missing_vars?: string[];
}

export type ExpandResult = ExpandSuccess | ExpandError;

function coerceVar(value: unknown, def: TemplateVarDef): string | number | boolean | undefined {
  if (value === undefined || value === null) {
    return def.default as string | number | boolean | undefined;
  }
  switch (def.type) {
    case "string":
      return String(value);
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        return undefined;
      }
      return n;
    }
    case "boolean":
      if (typeof value === "boolean") {
        return value;
      }
      if (value === "true" || value === 1 || value === "1") {
        return true;
      }
      if (value === "false" || value === 0 || value === "0") {
        return false;
      }
      return undefined;
    default:
      return undefined;
  }
}

function resolveVars(
  def: TemplateDef,
  rawVars: Record<string, unknown>,
): { resolvedVars: Record<string, string | number | boolean> } | ExpandError {
  const resolved: Record<string, string | number | boolean> = {};
  const missing: string[] = [];

  for (const varDef of def.vars) {
    const coerced = coerceVar(rawVars[varDef.name], varDef);
    if (coerced === undefined) {
      if (varDef.required && varDef.default === undefined) {
        missing.push(varDef.name);
        continue;
      }
      if (varDef.default !== undefined) {
        const defaultVal = varDef.default;
        if (varDef.path && typeof defaultVal === "string") {
          try {
            resolved[varDef.name] = safePath(defaultVal);
          } catch (error) {
            return {
              error: error instanceof Error ? error.message : String(error),
              template: def.id,
            };
          }
        } else {
          resolved[varDef.name] = defaultVal;
        }
      }
      continue;
    }
    if (varDef.path && typeof coerced === "string") {
      try {
        resolved[varDef.name] = safePath(coerced);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          template: def.id,
        };
      }
    } else {
      resolved[varDef.name] = coerced;
    }
  }

  if (missing.length > 0) {
    return { error: "missing required template vars", template: def.id, missing_vars: missing };
  }

  if (
    def.id === "json_pretty" &&
    resolved.path === undefined &&
    resolved.text === undefined
  ) {
    return { error: "json_pretty requires path or text", template: def.id };
  }

  return { resolvedVars: resolved };
}

function injectVars(body: string, def: TemplateDef, resolved: Record<string, string | number | boolean>): string {
  if (def.runtime === "bash") {
    let code = body;
    for (const [key, value] of Object.entries(resolved)) {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      const replacement =
        typeof value === "number" ? String(value) : `'${String(value).replace(/'/g, `'\\''`)}'`;
      code = code.replace(placeholder, replacement);
    }
    return code;
  }

  const varsLiteral = JSON.stringify(resolved, null, 2);
  if (body.includes("/*__VARS__*/")) {
    return body.replace("/*__VARS__*/", `const __VARS__: Record<string, unknown> = ${varsLiteral};`);
  }
  if (body.includes("# __VARS__")) {
    return body.replace("# __VARS__", `__VARS__ = ${varsLiteral}`);
  }
  return `const __VARS__: Record<string, unknown> = ${varsLiteral};\n${body}`;
}

export function expandTemplate(templateId: string, rawVars: Record<string, unknown> = {}): ExpandResult {
  const def = getTemplate(templateId);
  if (!def) {
    return { error: `unknown template: ${templateId}` };
  }

  const resolvedResult = resolveVars(def, rawVars);
  if ("error" in resolvedResult) {
    return resolvedResult;
  }

  const { resolvedVars } = resolvedResult;
  const bodyPath = path.join(BODIES_DIR, def.bodyFile);
  if (!fs.existsSync(bodyPath)) {
    return { error: `template body not found: ${def.bodyFile}`, template: def.id };
  }

  const body = fs.readFileSync(bodyPath, "utf8");
  const code = injectVars(body, def, resolvedVars);
  return { runtime: def.runtime, code, resolvedVars };
}
