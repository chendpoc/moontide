import type { UserInteraction } from "@moontide/tools";
import {
  choicePrompt,
  cliTheme,
  confirmToolPrompt,
} from "../../terminal/theme.js";
import { writeStderrLine } from "../../terminal/write.js";
import { truncateOneLine } from "@moontide/shared/utils/text.js";
import type { ReplTerminal } from "./terminal.js";

export function createReplUserInteraction(terminal: ReplTerminal): UserInteraction {
  return {
    async approveTool({ toolName, input }) {
      const preview = truncateOneLine(JSON.stringify(input), 80);
      const answer = await terminal.question(confirmToolPrompt(toolName, preview));
      return ["y", "yes"].includes(answer.trim().toLowerCase());
    },

    async askQuestion({ title, questions }) {
      if (title) {
        writeStderrLine(cliTheme.ask(title));
      }
      const answers: Array<{ question_id: string; selected: string[] }> = [];
      for (const question of questions) {
        writeStderrLine(cliTheme.ask(question.prompt));
        for (let i = 0; i < question.options.length; i += 1) {
          const opt = question.options[i]!;
          writeStderrLine(`  ${i + 1}. ${opt.label} (${opt.id})`);
        }
        const hint = question.allow_multiple ? "numbers comma-separated" : "number";
        const raw = await terminal.question(choicePrompt(hint));
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
