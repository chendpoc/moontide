export interface UserQuestionOption {
  id: string;
  label: string;
}

export interface UserQuestion {
  id: string;
  prompt: string;
  options: UserQuestionOption[];
  allow_multiple?: boolean;
}

export interface UserQuestionInput {
  title?: string;
  questions: UserQuestion[];
}

export interface UserQuestionAnswer {
  question_id: string;
  selected: string[];
}

export type UserQuestionPrompt = (input: UserQuestionInput) => Promise<UserQuestionAnswer[]>;

let promptFn: UserQuestionPrompt | null = null;

export function setUserQuestionPrompt(fn: UserQuestionPrompt | null): void {
  promptFn = fn;
}

export function isUserQuestionConfigured(): boolean {
  return promptFn !== null;
}

export async function promptUserQuestion(input: UserQuestionInput): Promise<UserQuestionAnswer[]> {
  if (!promptFn) {
    throw new Error("User question prompt is not configured");
  }
  return promptFn(input);
}
