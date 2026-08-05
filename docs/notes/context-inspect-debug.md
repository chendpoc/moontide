# Context Inspect Debug（分级全量 dump）

> 与 **thinking / verbose**（美化摘要、有截断）并列的第三档观测：**无截断全量** compose / llm_call / tool_use。实现位于 [`context-inspect/`](../../src/context-inspect/) + hook 适配 [`debug-hook-module`](../../src/plugins/builtin/context/debug-hook-module.ts)。

## 档位

| 档位 | stderr | 落盘 | 开启 |
|------|--------|------|------|
| **off** | — | — | 默认 |
| **terminal** | 全量 JSON 块 | `.moontide/debug/<runId>.jsonl` | `/debug on` · `MOONTIDE_DEBUG=1` |
| **file** | 同 terminal | 同 terminal | `/debug file` · `MOONTIDE_DEBUG=file`（别名） |

**与 verbose 区别：** verbose 打印 token bar、截断 preview；debug 输出完整 request/outcome，无 64KB Agent Event 投影限制。

## Hook 记录点

| phase | 内容 |
|-------|------|
| `composeComplete` | manifest + composed request |
| `llmCall` | request + outcome |
| `toolUse` | toolInput + outcome |

Hook 薄层在 `plugins/builtin/context/debug-hook-module.ts`；`context-inspect/debug-emit.ts` 不含 `agent/pipeline` 类型。

## REPL

```sh
/debug on|terminal|file|off|status
```

`/reset` 会 `resetDebugOverride()`，与 thinking/verbose 一致。

## 相关

- [README §CLI](../../README.md#cli)（Thinking / Verbose / Debug）
- `MOONTIDE_DEBUG` — [`.env.example`](../../.env.example)
