# crates 文档

这里维护 MoonTide Rust workspace 的跨 crate / 跨模块工程文档。

## 文档状态

| 文件 | 状态 | 用途 |
|------|------|------|
| [`engineering-handbook.md`](engineering-handbook.md) | 当前参考 | Rust 工程规则、分层、Conformance、术语和审查判据 |
| [`extension-request-pipeline.md`](extension-request-pipeline.md) | 候选设计 | 插件需求处理链路，尚未实现 |
| [`extension-sidecar-runtime.md`](extension-sidecar-runtime.md) | 候选设计 | sidecar / MCP 边界，尚未实现 |
| [`logging-and-session-design.md`](logging-and-session-design.md) | 候选设计 | 日志与 Session 方案，需以当前 `session` / `event` 契约为准 |
| [`tiered-context-memory.md`](tiered-context-memory.md) | 候选设计 | 分层 Context 与长期记忆，尚未实现 |

候选设计不自动覆盖当前契约。它们必须在开头声明状态，并在落地前同步到对应的 `docs/spec/` 或源码模块设计文档。

## 权威关系

```text
AGENTS.md
  每 turn 注入的可执行约束，最高优先级

crates/docs/engineering-handbook.md
  Rust 工程规则的详细解释、判据和示例

docs/spec/
  系统级当前契约

crates/agent-core/src/*/{README,DESIGN}.md
  模块局部使用说明与实现设计

crates/docs/*（除 handbook）
  候选设计、调研和迁移材料

docs/archive/
  TypeScript 时代历史资料，仅供追溯
```

发生冲突时，以 `AGENTS.md` 为准；handbook 不能放宽 runtime 约束。

## 阅读路径

### 修改 agent-core

1. [`../../AGENTS.md`](../../AGENTS.md)
2. [`engineering-handbook.md`](engineering-handbook.md)
3. [`../agent-core/README.md`](../agent-core/README.md)
4. 目标模块的 `src/{mod}/README.md` 与 `DESIGN.md`
5. 相关 [`../../docs/spec/`](../../docs/spec/)

### 判断文档应该放在哪里

| 问题 | 位置 |
|------|------|
| 是否是每次运行都必须遵守的工程约束？ | `AGENTS.md` |
| 是否是 Rust 工程的通用详细规则？ | `engineering-handbook.md` |
| 是否是系统当前应然契约？ | `../../docs/spec/` |
| 是否只属于一个模块？ | 对应 `src/{mod}/README.md` / `DESIGN.md` |
| 是否仍在调研、候选或迁移阶段？ | 本目录候选文档或 `../../docs/notes/` |

## 维护规则

- handbook 只写已经确认或明确标记为候选的 Rust 规则，不复制 TS 路径和命令。
- 新增硬约束先更新 `AGENTS.md`，再在 handbook 补充理由、判据和例子。
- 模块局部细节不要复制到 handbook；handbook 链接到模块文档即可。
- 变更分层、import 边界、trait、Session Item Log 或测试守门范围时，要同步更新 handbook、相关 Spec 和 `PROGRESS.md`。
- 每份候选文档必须保留状态和当前契约链接。
