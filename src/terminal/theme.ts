import chalk from "chalk";

import { PRODUCT_NAME } from "../constants/brand.js";

export const cliTheme = {
  dim: chalk.gray,
  prompt: chalk.cyan,
  confirm: chalk.yellow,
  ask: chalk.magenta,
};

export function replPrompt(): string {
  return `${cliTheme.prompt(`${PRODUCT_NAME} >>`)} `;
}

export function turnSeparator(): string {
  return cliTheme.dim("─".repeat(48));
}

export function confirmToolPrompt(toolName: string, preview: string): string {
  return `${cliTheme.confirm(`Allow ${toolName}? ${preview} [y/N]`)} `;
}

export function choicePrompt(hint: string): string {
  return `${cliTheme.prompt(`Your choice (${hint}):`)} `;
}
