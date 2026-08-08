import {
  contextBudgetFlexEnabled,
  contextBudgetFlexPct,
  contextBudgetL1,
  contextBudgetL3,
  contextBudgetL4,
  contextBudgetL5,
  getWorkdir,
  spillOptions,
} from "../config.js";
import type { BudgetConfig } from "@moontide/context-composer/ports";

/** Build BudgetConfig from product-layer env / config. */
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

/** Compose-time ports derived from config (workdir, spill, budget). */
export function composePortsFromConfig(workdir = getWorkdir()) {
  return {
    workdir,
    spillOptions: spillOptions(),
    budget: budgetConfigFromEnv(),
  };
}
