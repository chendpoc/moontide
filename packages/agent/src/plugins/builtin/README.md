
本目录是 MoonTide **内置 plugin**（hook 模块、可选 tool、session 持久化等）。与 tool 相关的模块遵循 [AGENTS.md §2.1](../../../AGENTS.md#21-声明与实现分离spec--impl-split) 的 Spec / Impl 分离；操作细节见各子目录。

## 文档索引

| 文档 | 内容 |
|------|------|
| [AGENTS.md §2.1](../../../AGENTS.md#21-声明与实现分离spec--impl-split) | Spec / Impl 通用原则 |
| [packages/tools/src/builtins/README.md](../../../packages/tools/src/builtins/README.md) | 核心 builtin tool 目录约定（`@moontide/tools`） |
| 本文 | plugin 模块一览、含 tool 的子目录结构 |
| [docs/README.md](../../../docs/README.md) | 全仓库 Doc Map |

## 模块一览

| 目录 | 性质 | Tool |
|------|------|------|
| [`context/`](context/) | Hook：context metrics、debug dump | —（`inspect_context` 已迁至 [`packages/tools` builtins/context](../../../packages/tools/src/builtins/context/)） |
| [`code-repl/`](code-repl/) | 可选 tool + runtime | `code_repl` → [`tools.ts`](code-repl/tools.ts) + [`executor.ts`](code-repl/executor.ts) |
| [`deep-research/`](deep-research/) | 可选 tool | `deep_research` → [`tools.ts`](deep-research/tools.ts) + [`handler.ts`](deep-research/handler.ts) |
| [`tool-use-log/`](tool-use-log/) | Hook：tool 使用日志 | — |
| [`session-persistence/`](session-persistence/) | REPL `/save` · `/resume` | — |
| [`work-mem/`](work-mem/) | Deep Task Mode 可选 tool + jsonl store | `work_mem` → [`tools.ts`](work-mem/tools.ts) + [`handler.ts`](work-mem/handler.ts)（`deep:` gate；[`register.ts`](work-mem/register.ts) 挂 agent port） |

## 含 tool 的 plugin：目录约定

与 [`packages/tools/src/builtins/`](../../../packages/tools/src/builtins/README.md) 相同：**impl 文件 + `tools.ts`**，工厂统一 `defineXxxTools(): ToolDefinition[] | null`。

```
code-repl/
  executor.ts       # run / 副作用
  tools.ts          # ToolSpec + defineCodeReplTools()
  index.ts          # 对外 re-export（probe、executeCodeRepl 等），不含 spec

deep-research/
  handler.ts        # runDeepResearch
  tools.ts          # defineDeepResearchTools()
  index.ts          # re-export types / handler
```

可选 tool：`defineXxxTools()` 在禁用时返回 `null`；[`register-defaults.ts`](../../tools/register-defaults.ts) 以 `{ factory: defineXxxTools, optional: true }` 注册。

## 注册入口

[`packages/agent-cli/src/tools/register-defaults.ts`](../../tools/register-defaults.ts) → `BUILTIN_PLUGIN_TOOL_MANIFEST`：

```typescript
{ factory: defineCodeReplTools, optional: true },
{ factory: defineDeepResearchTools, optional: true },
{ factory: defineWorkMemTools, optional: true },
```

## 新增 plugin tool checklist

1. 在 plugin 子目录新增 **impl**（如 `handler.ts`），export `runXxx`。
2. 新增 **`tools.ts`**：`ToolSpec` + `defineXxxTools()`（复数、返回数组或 `null`）。
3. **`index.ts`** 仅 re-export impl / 类型，不声明 `ToolSpec`。
4. 更新 [`names.ts`](../../tools/names.ts)、permission 表、[`register-defaults.ts`](../../tools/register-defaults.ts)。
5. 跑 `pnpm test:conformance`（含 [`architecture-boundaries.test.ts`](../../../tests/conformance/architecture-boundaries.test.ts) §2.1 扫描）。

## Conformance

[`tests/conformance/architecture-boundaries.test.ts`](../../../tests/conformance/architecture-boundaries.test.ts) 对 `plugins/builtin/code-repl` 与 `deep-research` 的 impl 文件扫描：不得出现 `ToolSpec` / `defineTool(s)`；不得 export `defineXxxTool()` 单数工厂。
