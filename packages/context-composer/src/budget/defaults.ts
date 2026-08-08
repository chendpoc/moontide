/**
 * Default Context Budget Tier caps at C = 128k.
 *
 * Tier glossary (L1 → L5). See docs/spec/context-composer.md §16.
 *
 * **L1 Pinned** (`pinned`)
 *   Instruction State + Tool Definitions + compaction inject + Working Set.
 *   Lives in `system` + `tools`. Non-prunable; over cap → alert `pinned_over_budget`.
 *
 * **L2 Dialogue** (`dialogue`)
 *   Compiled `messages` (user / assistant / inline tool_result).
 *   No fixed constant — allocation is dynamic:
 *   `L2_limit = C − L4 [− L5] − L1_cap − L3_cap`.
 *   Auto-compact threshold is L2-scoped: `L2_used / L2_limit`.
 *
 * **L3 Reference** (`reference`)
 *   ToolResultSummary and short refs (full tool bodies stay out of band / spill).
 *
 * **L4 Reserved** (`reserved`)
 *   Output headroom: `maxOutputTokens` (+ thinking slack if supported).
 *   Deducted from C first; excluded from input token sum.
 *
 * **L5 Flex** (`flex`, MVP+)
 *   Estimate-error buffer; optional `DEFAULT_FLEX_PCT` of C before L2 is computed.
 *
 * Env overrides: CONTEXT_BUDGET_L1/L3/L4/L5/FLEX/FLEX_PCT (see APP_ENV).
 * When C < 128k, L1/L3 caps scale down proportionally unless env overrides are set.
 *
 * ---
 * 中文（L1 → L5 分账，默认按 C = 128k）：
 *
 * - **L1 固定层**：指令（AGENTS/rules）、工具 schema、compaction 注入、Deep Mode Working Set；
 *   占 `system` + `tools`，不参与 prune；超 cap 告警 `pinned_over_budget`，不截断 system。
 * - **L2 对话层**：编译后的 `messages`（含 inline 的 tool_result 全文）；
 *   上限动态 = 总窗 − L4 [− L5] − L1 cap − L3 cap；auto-compact 只看 L2 用量占比。
 * - **L3 引用层**：ToolResultSummary、短引用；大结果走 artifact spill，不全文 inline。
 * - **L4 输出预留**：本轮 max output（+ thinking 余量）；先从 C 扣除，不计入 input 合计。
 * - **L5 弹性缓冲**（MVP+）：token 估算误差 slack，按 C 的百分比预留后再算 L2。
 *
 * 环境变量可覆盖各 tier cap；C < 128k 时 L1/L3 默认 cap 会按比例缩小（除非显式 env）。
 */

// --- L1 Pinned / L1 固定层 ---
/** 128k 下 L1 默认 cap（含 tools）。 */
export const DEFAULT_L1_CAP = 32_000;

// --- L2 Dialogue / L2 对话层：上限在 policy.ts 运行时计算 ---

// --- L3 Reference / L3 引用层 ---
/** 128k 下 L3 summary/引用总量默认 cap。 */
export const DEFAULT_L3_CAP = 10_000;

// --- L4 Reserved / L4 输出预留 ---
/** 支持 thinking 时，在 maxOutputTokens 上额外预留的 token。 */
export const THINKING_HEADROOM_DEFAULT = 4_000;

/** L4 合计 fallback（128k 基线：8192 输出 + 4000 thinking）。 */
export const DEFAULT_L4_FALLBACK = 12_000;

// --- L5 Flex (MVP+) / L5 弹性缓冲 ---
/** 启用 flex 时占 C 的百分比（128k × 5% = 6400）。 */
export const DEFAULT_FLEX_PCT = 5;
