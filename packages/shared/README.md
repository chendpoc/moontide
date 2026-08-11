# @moontide/shared

跨平台原语层：constants、errors、utils、storage，以及**无域语义**的跨层 protocol 小类型。业务包（agent、session、llm…）依赖 shared；shared **不**依赖任何 `@moontide/*` 业务包。

设计原则见 [`AGENTS.md`](../../AGENTS.md) §1（分层）· 类型 import 决策见 [`docs/spec/type-imports.md`](../../docs/spec/type-imports.md)。

## 子路径

| Subpath | 职责 |
|---------|------|
| `@moontide/shared/constants/*` | `MOONTIDE_*` env 键、默认值、路径常量 |
| `@moontide/shared/errors/*` | 工具链/权限/infra `ErrorCode`、`MoonTideError`、`toMessage` |
| `@moontide/shared/protocol/*` | LLM 与 run 共用的极小 enum（如 `ToolArgumentStatus`） |
| `@moontide/shared/utils/*` | path、fs、glob、text（唯一允许 touch 对应 Node builtin 的封装入口） |
| `@moontide/shared/storage/*` | NDJSON、list-json 等 MoonTide 存储原语 |

## 何时用 shared

- 读 env / 拼 `.moontide` 路径 → `constants/*` + `utils/path`
- Tool 预期失败、permission deny → `errors/*`（**不是** run-protocol 的 `Outcome`）
- 两个及以上域包需要同一无业务枚举 → `protocol/*`，域包 re-export
- 直接 `import fs from "node:fs"` 在业务层 → **应改为** `utils/fs`

## 不做什么

| 禁止 | 说明 |
|------|------|
| Run / Session / LLM 域模型 | 见 run-protocol、session、llm/protocol |
| Harness / compose 逻辑 | 见 agent、context-composer |

## 相关

- [`type-imports.md`](../../docs/spec/type-imports.md) — 全仓库类型 import 表
- [`utils-infrastructure.md`](../../docs/notes/runtime/utils-infrastructure.md) — 原语层约定
