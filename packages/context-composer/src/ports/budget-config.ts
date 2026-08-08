/** Context budget tier caps injected by product layer (no env reads in composer). */
export interface BudgetConfig {
  l1Cap?: number;
  l3Cap?: number;
  l4Cap?: number;
  l5Cap?: number;
  flexPct?: number;
  flexEnabled: boolean;
}

export const defaultBudgetConfig: BudgetConfig = {
  flexEnabled: true,
};
