import {
  contextBudgetFlexEnabled,
  contextBudgetFlexPct,
  contextBudgetL1,
  contextBudgetL3,
  contextBudgetL4,
  contextBudgetL5,
} from "../../apps/moontide/src/config.js";
import type { BudgetConfig } from "@moontide/context-composer/ports";

/** Read BudgetConfig from env (for tests that stub MOONTIDE_CONTEXT_BUDGET_*). */
export function budgetConfigFromEnv(): BudgetConfig {
  return {
    l1Cap: contextBudgetL1(),
    l3Cap: contextBudgetL3(),
    l4Cap: contextBudgetL4(),
    l5Cap: contextBudgetL5(),
    flexPct: contextBudgetFlexPct(),
    flexEnabled: contextBudgetFlexEnabled(),
  };
}
