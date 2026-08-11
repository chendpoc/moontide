import chalk from "chalk";

import { categoryLabel, helpStrings, localizeHelpSummary } from "../../i18n/help/index.js";
import { resolveLocale } from "../../i18n/locale.js";
import { replCommandHelpSections, type ReplHelpSection } from "./registry.js";
import { reply } from "./io.js";
import type { ReplCommandResult } from "./types.js";

const SYNTAX_COLUMN_MIN = 28;

function formatHelpSections(sections: ReplHelpSection[]): string[] {
  const lang = resolveLocale();
  const maxSyntax = Math.max(
    SYNTAX_COLUMN_MIN,
    ...sections.flatMap((section) => section.entries.map((entry) => entry.syntax.length)),
  );

  const lines: string[] = [];
  for (const section of sections) {
    lines.push(chalk.bold(categoryLabel(section.category, lang)));
    for (const entry of section.entries) {
      const syntax = chalk.cyan(entry.syntax.padEnd(maxSyntax));
      const summary = localizeHelpSummary(entry.syntax, entry.summary, lang);
      const summaryText = summary ? chalk.dim(summary) : "";
      lines.push(`  ${syntax}  ${summaryText}`.trimEnd());
    }
    lines.push("");
  }
  return lines;
}

export function handleHelpCommand(): ReplCommandResult {
  const lang = resolveLocale();
  const copy = helpStrings(lang);

  reply(chalk.bold(copy.title));
  reply("");
  for (const line of formatHelpSections(replCommandHelpSections())) {
    reply(line);
  }
  reply("");
  reply(copy.legend);
  reply(chalk.dim(copy.languageHint(lang)));
  return "handled";
}
