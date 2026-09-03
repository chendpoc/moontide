# crates/docs

MoonTide Rust workspace 的**跨 crate** 工程文档。模块实现细节在 `crates/*/DESIGN.md` + `src/{mod}/README.md`；可执行约束在根 `AGENTS.md`。

## 目录结构

```text
crates/docs/
├── README.md                 # 本索引与放置规则
├── engineering-handbook.md   # 工程手册（AGENTS.md 固定链接，勿移）
├── agent-core.md             # agent-core 系统摘要（固定链接，勿移）
├── features/                 # Feature 对齐（产品 + 架构已确认）
├── design/                   # 当前有效的跨 crate 设计契约
├── plans/                    # 有时间边界的实施 / 重构计划
├── candidates/               # 候选 / 调研（无实施承诺）
└── archive/                  # superseded 或已完成的历史文档
    ├── plans/                # 已完成实施计划
    └── desktop/              # Desktop 历史 refactor / 架构记录
```

## 命名规则

| 规则 | 说明 |
|------|------|
| **kebab-case** | 全小写、连字符；禁止空格、`Feature_` 前缀 |
| **无 `-TASKS` 后缀** | 任务跟踪用 GitHub Issue；历史 `-TASKS.md` 与计划文档同目录归档 |
| **状态头** | 每份文档开头 `> **状态：**` 标明当前 / 候选 / 已完成 / superseded |
| **Feature 文档** | 放 `features/`；文件名 `DOMAIN-SUBJECT.md`（如 `LLM-FOUR-AXIS.md`） |

## 文档索引

### 固定锚点（根目录）

| 文件 | 状态 | 用途 |
|------|------|------|
| [`engineering-handbook.md`](engineering-handbook.md) | 当前参考 | Rust 工程规则、分层、Conformance、术语 |
| [`agent-core.md`](agent-core.md) | 当前设计 | 八模块 owner、依赖方向、跨模块不变量摘要 |

### features/

| 文件 | 状态 | 用途 |
|------|------|------|
| [`LLM-FOUR-AXIS.md`](features/LLM-FOUR-AXIS.md) | 已实现 | Provider / Protocol / Model / Base URL 四轴与三协议 |

### design/

| 文件 | 状态 | 用途 |
|------|------|------|
| [`logging-and-session-design.md`](design/logging-and-session-design.md) | 当前设计 | Session Item Log、Agent Event Log、Progress、persistence policy |
| [`startup-config-layering.md`](design/startup-config-layering.md) | 当前设计 | host-owned settings、provider-scoped 合并 |
| [`agnes-provider-integration.md`](design/agnes-provider-integration.md) | 当前设计 | Agnes provider 与 catalog 集成 |

### plans/

| 文件 | 状态 | 用途 |
|------|------|------|
| [`loop-owned-llm-event-consumption-refactor.md`](plans/loop-owned-llm-event-consumption-refactor.md) | 候选计划 | loop 内显式消费 `ModelStreamEvent` |

### candidates/

| 文件 | 状态 | 用途 |
|------|------|------|
| [`extension-request-pipeline.md`](candidates/extension-request-pipeline.md) | 候选 | 插件需求处理链路 |
| [`extension-sidecar-runtime.md`](candidates/extension-sidecar-runtime.md) | 候选 | sidecar / MCP 边界 |
| [`tiered-context-memory.md`](candidates/tiered-context-memory.md) | 候选 | 分层 Context 与长期记忆 |
| [`tool-mediated-context-exploration.md`](candidates/tool-mediated-context-exploration.md) | 讨论候选 | 工具有界探索 |
| [`typed-tag-session-library.md`](candidates/typed-tag-session-library.md) | 候选 | Typed Tag Session Library |

### archive/

| 文件 | 状态 | 用途 |
|------|------|------|
| [`plans/llm-provider-config-fix.md`](archive/plans/llm-provider-config-fix.md) | 已完成 | LLM provider / 启动配置修复批次（2026-08） |
| [`desktop-process-architecture-superseded.md`](archive/desktop-process-architecture-superseded.md) | superseded | 早期归档副本 |
| [`desktop/desktop-process-architecture.md`](archive/desktop/desktop-process-architecture.md) | superseded | D4 agent-host 进程化 |
| [`desktop/desktop-local-communication-architecture.md`](archive/desktop/desktop-local-communication-architecture.md) | superseded | integrated runtime 前本地通信 |
| [`desktop/desktop-stack-simplification-refactor.md`](archive/desktop/desktop-stack-simplification-refactor.md) | 已完成 | Desktop 栈精简 R2 |
| [`desktop/tauri-protocol-boundary-refactor.md`](archive/desktop/tauri-protocol-boundary-refactor.md) | 历史已完成 | D3-PF protocol-first slice |
| [`desktop/tauri-protocol-boundary-refactor-TASKS.md`](archive/desktop/tauri-protocol-boundary-refactor-TASKS.md) | 历史 | 上列计划的任务跟踪（deprecated） |

Desktop 当前设计：[`../moontide-desktop/DESIGN.md`](../moontide-desktop/DESIGN.md)。

## 文档层级

```text
AGENTS.md                          # 每 turn 可执行约束（最高）
  ↓
crates/docs/engineering-handbook.md
  ↓
crates/docs/agent-core.md + design/ + features/
  ↓
crates/*/DESIGN.md + src/{mod}/README.md
  ↓
candidates/ · plans/（未确认或批次性）· archive/（追溯）
```

冲突时：已确认产品目标 > live source + tests > 标记为「当前」的 design/features 文档 > 候选与 archive。

## 放置决策

| 问题 | 位置 |
|------|------|
| 每次运行必须遵守？ | `AGENTS.md` |
| Rust 通用工程规则？ | `engineering-handbook.md` |
| 跨 crate 且当前有效？ | `design/` 或 `features/` |
| Feature 产品 + 架构对齐？ | `features/` |
| 单 crate / 单模块？ | `crates/*/DESIGN.md` + `src/{mod}/README.md` |
| 有时间边界的 refactor 计划？ | `plans/`（完成后可移 `archive/`） |
| 调研 / 未确认方向？ | `candidates/` |
| superseded 或仅追溯？ | `archive/` |

## 阅读路径

### 改 agent-core

1. [`../../AGENTS.md`](../../AGENTS.md)
2. [`engineering-handbook.md`](engineering-handbook.md)
3. [`agent-core.md`](agent-core.md) → [`../agent-core/DESIGN.md`](../agent-core/DESIGN.md)
4. 目标模块 [`../agent-core/src/{mod}/README.md`](../agent-core/README.md)

### 改 LLM / provider

1. [`features/LLM-FOUR-AXIS.md`](features/LLM-FOUR-AXIS.md)
2. [`design/startup-config-layering.md`](design/startup-config-layering.md)
3. [`../agent-core/DESIGN.md#llm`](../agent-core/DESIGN.md#llm) · [`../agent/DESIGN.md`](../agent/DESIGN.md)

## 维护规则

- 新增硬约束先写 `AGENTS.md`，再在 handbook 补理由与示例。
- 模块细节不复制进 handbook；handbook 链接到 crate / 模块文档。
- 分层、Session Item Log、Conformance 变更时同步 handbook、`agent-core.md`、相关 `design/` 与 `PROGRESS.md`。
- 移动文档后必须更新本索引与全库 inbound 链接；跑 scoped link 检查（见 doc cleanup 脚本或 `rg` 断链排查）。
