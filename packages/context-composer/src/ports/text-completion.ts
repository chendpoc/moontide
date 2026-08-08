/** Narrow LLM text completion — harness binds to provider chat. */
export interface TextCompletionPort {
  complete(input: {
    system: string;
    user: string;
    maxTokens?: number;
  }): Promise<string>;
}
