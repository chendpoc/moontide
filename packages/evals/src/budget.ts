/** Exit code when soft budget limit is exceeded. */
export const EVAL_EXIT_BUDGET_EXCEEDED = 2;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelPricingMicroCny {
  /** Micro-CNY per input token (1 micro-CNY = 1e-6 CNY). */
  inputMicroCnyPerToken: number;
  /** Micro-CNY per output token. */
  outputMicroCnyPerToken: number;
}

/** Approximate DeepSeek V4 Flash list pricing (CNY per 1M tokens → micro-CNY/token). */
const MODEL_PRICING: Record<string, ModelPricingMicroCny> = {
  "deepseek-v4-flash": {
    inputMicroCnyPerToken: 0.2,
    outputMicroCnyPerToken: 0.4,
  },
  "deepseek-v4-pro": {
    inputMicroCnyPerToken: 2,
    outputMicroCnyPerToken: 8,
  },
};

const FALLBACK_PRICING: ModelPricingMicroCny = MODEL_PRICING["deepseek-v4-flash"]!;

export function pricingForModel(modelId: string): ModelPricingMicroCny {
  return MODEL_PRICING[modelId] ?? FALLBACK_PRICING;
}

export function usageCostMicroCny(usage: TokenUsage, modelId: string): number {
  const pricing = pricingForModel(modelId);
  return (
    usage.inputTokens * pricing.inputMicroCnyPerToken +
    usage.outputTokens * pricing.outputMicroCnyPerToken
  );
}

export interface BudgetUsageBreakdown {
  agentInputTokens: number;
  agentOutputTokens: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  agentCostMicroCny: number;
  judgeCostMicroCny: number;
}

export interface BudgetSummary extends BudgetUsageBreakdown {
  costMicroCny: number;
  budgetMicroCny?: number;
  budgetExceeded: boolean;
}

export class BudgetLedger {
  private _agentInput = 0;
  private _agentOutput = 0;
  private _judgeInput = 0;
  private _judgeOutput = 0;
  private _agentCost = 0;
  private _judgeCost = 0;
  private readonly _limitMicroCny?: number;

  constructor(limitMicroCny?: number) {
    this._limitMicroCny =
      limitMicroCny !== undefined && Number.isFinite(limitMicroCny) && limitMicroCny > 0
        ? Math.floor(limitMicroCny)
        : undefined;
  }

  recordAgentUsage(usage: TokenUsage, modelId: string): void {
    this._agentInput += usage.inputTokens;
    this._agentOutput += usage.outputTokens;
    this._agentCost += usageCostMicroCny(usage, modelId);
  }

  recordAgentOutput(
    output: { inputTokens: number; outputTokens: number },
    modelId: string,
  ): void {
    this.recordAgentUsage(
      { inputTokens: output.inputTokens, outputTokens: output.outputTokens },
      modelId,
    );
  }

  recordJudgeUsage(usage: TokenUsage, modelId: string): void {
    this._judgeInput += usage.inputTokens;
    this._judgeOutput += usage.outputTokens;
    this._judgeCost += usageCostMicroCny(usage, modelId);
  }

  totalCostMicroCny(): number {
    return this._agentCost + this._judgeCost;
  }

  exceedsLimit(): boolean {
    return this._limitMicroCny !== undefined && this.totalCostMicroCny() > this._limitMicroCny;
  }

  summary(): BudgetSummary {
    const costMicroCny = this.totalCostMicroCny();
    return {
      agentInputTokens: this._agentInput,
      agentOutputTokens: this._agentOutput,
      judgeInputTokens: this._judgeInput,
      judgeOutputTokens: this._judgeOutput,
      agentCostMicroCny: this._agentCost,
      judgeCostMicroCny: this._judgeCost,
      costMicroCny,
      budgetMicroCny: this._limitMicroCny,
      budgetExceeded: this._limitMicroCny !== undefined && costMicroCny > this._limitMicroCny,
    };
  }
}
