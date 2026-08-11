import chalk from "chalk";

import { fmtNum } from "../../i18n/context/index.js";

const TOK_SUFFIX = " tok";

/** Git-style delta: +N green, -N red. */
export function formatDeltaColored(delta: number, withSuffix = true): string {
  const suffix = withSuffix ? TOK_SUFFIX : "";
  const text = delta >= 0 ? `+${fmtNum(delta)}${suffix}` : `${fmtNum(delta)}${suffix}`;
  return delta >= 0 ? chalk.green(text) : chalk.red(text);
}

export function formatDeltaPlain(delta: number, withSuffix = true): string {
  const suffix = withSuffix ? TOK_SUFFIX : "";
  return delta >= 0 ? `+${fmtNum(delta)}${suffix}` : `${fmtNum(delta)}${suffix}`;
}
