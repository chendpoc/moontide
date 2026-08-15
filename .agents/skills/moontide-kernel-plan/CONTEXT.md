# 讨论上下文索引

> 历次设计讨论沉淀的位置与主题。以下路径均相对于项目根 `/Users/chenjiayu/code/agent-learning/moontide/`。

## 候选设计文档（`crates/docs/`）

| 文档 | 主题 |
|---|---|
| `crates/docs/extension-request-pipeline.md` | 插件设计 Agent：用户扩展需求处理链路（意图澄清 → 判断 → draft → review → judge 门禁） |
| `crates/docs/tiered-context-memory.md` | 分层 Context 与长期记忆：L0/L1/L2 懒加载 + session→memory 蒸馏（借鉴 OpenViking） |
| `crates/docs/extension-sidecar-runtime.md` | 扩展边界与 Sidecar Runtime：通信四层、隔离、runtime 成本分配（共享 runtime 默认） |
| `crates/docs/logging-and-session-design.md` | 日志与 Session：三流分离 + session log 四不变量 + 双写原则 |

## 当前契约与架构（`docs/`）

| 文档 | 主题 |
|---|---|
| `docs/spec/agent-core.md` | 当前契约：时序唯一权威、窄钩子按签名、拒绝 context 容器、扩展不进 process |
| `docs/spec/agent-events.md` | Agent Event Log 的 schema 与持久化边界 |
| `docs/spec/context-composer.md` | Session / Context Composer / Compaction / Context Manifest |
| `docs/notes/runtime/agent-kernel-architecture.md` | 内核架构收敛：crate 判据、多语言 trade-off、event bus、决策清单 |
| `docs/notes/runtime/migration-plan.md` | TypeScript → Rust 多语言迁移的分阶段 checklist |

## 关键设计决策速查

1. **三流分离**：session log（可重放事实）· logger（可丢弃诊断，stderr）· stdout（外部消费数据）。判断标准：模型可见 / resume 要知道 → session log；否则 → logger。
2. **session 四不变量**：`seq == log.len()`、先校验后冻结、模型可见先入 log、header 外置。
3. **扩展边界**：sidecar（进程间）+ MCP（JSON-RPC over stdio）；隔离靠 OS 进程边界强制，非约定。
4. **runtime 成本**：共享 runtime 默认（O(版本数)），embedded（打包单文件）例外（O(N) 重复）。
5. **双写原则**：生命周期事实双写——session log 记「发生了什么」，logger 记「怎么发生」。
6. **错误建模**：取消原因（user/parent/hook/disposed）与请求失败（可恢复/不可恢复）是两个正交枚举；steer 是独立通道。
7. **llm 分层（2026-08-14）**：`llm/protocol/` = MoonTide 协议（block 模型）；`LLMProvider` = 唯一 trait；`AdapterFamily` = wire 协议族（与 preset 解耦）；每个 family 必须配对 `adapter/{family}/` + `normalize/{family}/`（族内 tool/thinking/stream）；跨族逻辑仅 `normalize/common.rs`；preset/路由在 `agent/`，不在 llm；首版 DeepSeek 默认 `OpenAiChatCompletions`。详 [`crates/agent-core/src/llm/README.md`](../../../crates/agent-core/src/llm/README.md)。
8. **llm 流式消费（2026-08-15）**：`ModelStreamEvent`（含 `block_index`）由 adapter 产出；`ModelResponseBuilder` 唯一 fold → `ModelResponseSnapshot`（含 `pending`）/ `ModelResponse`；loop 经 `run_model_call*`（禁止直接 match 事件）；`Finished` 非全文 Completed；lifecycle 归 `RunEvent`。
8. **实现子流程**：README ☑ → [`batch-implement`](batch-implement/SKILL.md)——Review 批合并交付；GitHub stacked PR：`r1→base`，`r{n≥2}→r{n−1}`，R{n−1} merge 后 rebase 改 base；模块完成 `base→main`。

## TODO 关联条目

`TODO.md`：16 内核 Rust 化（当前主轨）· 17 跨语言契约 · 18 多语言边界 · 19 插件设计 Agent · 20 分层 Context · 21 Sidecar Runtime · 22 日志与 Session。
