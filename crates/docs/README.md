# crates 文档

这里维护 MoonTide Rust workspace 的跨 crate / 跨模块工程文档。

## 文档状态

| 文件 | 状态 | 用途 |
|------|------|------|
| [`engineering-handbook.md`](engineering-handbook.md) | 当前参考 | Rust 工程规则、分层、Conformance、术语和审查判据 |
| [`agent-core.md`](agent-core.md) | 当前设计 | Rust Agent Core 的系统 owner、依赖方向和跨模块不变量 |
| [`extension-request-pipeline.md`](extension-request-pipeline.md) | 候选设计 | 插件需求处理链路，尚未实现 |
| [`extension-sidecar-runtime.md`](extension-sidecar-runtime.md) | 候选设计 | sidecar / MCP 边界，尚未实现 |
| [`logging-and-session-design.md`](logging-and-session-design.md) | 当前设计 | Session Item Log、Agent Event Log、Progress 与 persistence policy 统一契约 |
| [`../moontide-desktop/DESIGN.md`](../moontide-desktop/DESIGN.md) | 当前设计 | integrated Desktop runtime、typed invoke、Host ownership、事件与错误接受语义 |
| [`desktop-local-communication-architecture.md`](desktop-local-communication-architecture.md) | 已 superseded | integrated runtime 的历史设计输入；有效决定已并入 Desktop DESIGN |
| [`desktop-process-architecture.md`](desktop-process-architecture.md) | 已归档 / superseded | 历史 D4 `agent-host` 进程化方案，不再是承诺目标 |
| [`tauri-protocol-boundary-refactor.md`](tauri-protocol-boundary-refactor.md) | 历史已完成计划 | D3-PF protocol-first vertical slice 记录；与 integrated runtime 冲突处已 superseded |
| [`tiered-context-memory.md`](tiered-context-memory.md) | 候选设计 | 分层 Context 与长期记忆，尚未实现 |
| [`tool-mediated-context-exploration.md`](tool-mediated-context-exploration.md) | 讨论候选 | 基础工具优先、语义工具加速与大内容有界探索，尚未实现 |
| [`agnes-provider-integration.md`](agnes-provider-integration.md) | 当前设计 | Agnes provider、`agent::llm` catalog 与显式 OpenAI thinking option |
| [`startup-config-layering.md`](startup-config-layering.md) | 当前设计 | host-owned settings、provider-scoped 四层合并与 resolved provider |
| [`llm-provider-config-fix.md`](llm-provider-config-fix.md) | 已完成修复计划 | 当前未提交批次的工程修复任务、依赖和验收标准 |
| [`loop-owned-llm-event-consumption-refactor.md`](loop-owned-llm-event-consumption-refactor.md) | 候选计划 | 将 LLM 调用从 `on_update` 回调改为 loop 内显式消费 `ModelStreamEvent`，待架构评审 |
| [`desktop-stack-simplification-refactor.md`](desktop-stack-simplification-refactor.md) | **已完成（integrated runtime）** | Host 已并入 `moontide-desktop`；门禁见 [`../moontide-desktop/docs/UI-V0.1-SCOPE.md`](../moontide-desktop/docs/UI-V0.1-SCOPE.md) |

文档是设计意图、边界与 review 提示，不替代对 live source、tests、acceptance evidence
和工程质量的判断。候选设计不自动改变已确认方向；确认后应同步到当前设计文档与实现。
文档之间出现冲突时先验证实际 owner、数据流和 failure semantics，不能只按文档层级判定
实现好坏。

## 使用关系

```text
AGENTS.md
  每 turn 注入的可执行约束，最高优先级

crates/docs/engineering-handbook.md
  Rust 工程规则的辅助解释、判据和示例

crates/docs/*.md（标记为当前）
  已确认设计意图、owner、边界和不变量的 review 指引

crates/agent-core/src/*/{README,DESIGN}.md
  模块局部使用说明与实现设计

docs/spec/ + docs/notes/
  候选、draft、调研和迁移材料

docs/archive/
  TypeScript 时代历史资料，仅供追溯
```

`AGENTS.md` 中的 runtime 可执行约束仍必须遵守。其他文档提供设计证据和软提示；
发生冲突时应回到已确认产品目标、live source、tests 与 acceptance evidence 重新判断，
不能把“与文档不同”本身当成工程缺陷。

## 阅读路径

### 修改 agent-core

1. [`../../AGENTS.md`](../../AGENTS.md)
2. [`engineering-handbook.md`](engineering-handbook.md)
3. [`agent-core.md`](agent-core.md)
4. [`../agent-core/README.md`](../agent-core/README.md)
5. 目标模块的 `src/{mod}/README.md` 与 `DESIGN.md`

### 判断文档应该放在哪里

| 问题 | 位置 |
|------|------|
| 是否是每次运行都必须遵守的工程约束？ | `AGENTS.md` |
| 是否是 Rust 工程的通用详细规则？ | `engineering-handbook.md` |
| 是否是 Rust 系统当前 owner、边界或不变量？ | 本目录中标记为当前的文档 |
| 是否只属于一个模块？ | 对应 `src/{mod}/README.md` / `DESIGN.md` |
| 是否仍在调研、候选或迁移阶段？ | 本目录候选文档、`../../docs/spec/` 或 `../../docs/notes/` |

## 维护规则

- handbook 只写已经确认或明确标记为候选的 Rust 规则，不复制 TS 路径和命令。
- 新增硬约束先更新 `AGENTS.md`，再在 handbook 补充理由、判据和例子。
- 模块局部细节不要复制到 handbook；handbook 链接到模块文档即可。
- 变更分层、import 边界、trait、Session Item Log 或测试守门范围时，要同步更新 handbook、相关当前 Rust 系统设计和 `PROGRESS.md`。
- 每份候选文档必须保留状态和当前契约链接。
