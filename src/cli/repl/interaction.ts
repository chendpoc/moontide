import type readline from "node:readline/promises";

import type { UserInteraction } from "../../tools/types.js";
import { truncateOneLine } from "../../utils/text.js";

export function createReplUserInteraction(rl: readline.Interface): UserInteraction {
  return {
    async approveTool({ toolName, input }) {
      const preview = truncateOneLine(JSON.stringify(input), 80);
      const answer = await rl.question(
        `\x1b[33mAllow ${toolName}? ${preview} [y/N]\x1b[0m `,
      );
      return ["y", "yes"].includes(answer.trim().toLowerCase());
    },

    async askQuestion({ title, questions }) {
      if (title) {
        console.error(`\x1b[35m${title}\x1b[0m`);
      }
      const answers: Array<{ question_id: string; selected: string[] }> = [];
      for (const question of questions) {
        console.error(`\x1b[35m${question.prompt}\x1b[0m`);
        for (let i = 0; i < question.options.length; i += 1) {
          const opt = question.options[i]!;
          console.error(`  ${i + 1}. ${opt.label} (${opt.id})`);
        }
        const hint = question.allow_multiple ? "numbers comma-separated" : "number";
        const raw = await rl.question(`\x1b[36mYour choice (${hint}): \x1b[0m`);
        const indices = raw
          .split(/[,;\s]+/)
          .map((part) => Number(part.trim()) - 1)
          .filter((idx) => idx >= 0 && idx < question.options.length);
        const selected =
          indices.length > 0
            ? [...new Set(indices.map((idx) => question.options[idx]!.id))]
            : question.options[0]
              ? [question.options[0].id]
              : [];
        answers.push({ question_id: question.id, selected });
      }
      return answers;
    },
  };
}

export function createReplUserInteractionOnly(rl: readline.Interface): UserInteraction {
  return createReplUserInteraction(rl);
}
