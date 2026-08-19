# MoonTide 当前产品计划

> **性质：** Confirmed product baseline
> **当前阶段：** Desktop Shell v0.1
> **执行路线：** [`../../TODO.md`](../../TODO.md)
> **详细能力清单：** [`desktop-development-direction.md`](desktop-development-direction.md)
> **成熟产品方向：** [`mature-product-direction.md`](mature-product-direction.md)
> **历史版本：** [`../archive/product/plan-legacy-2026-08.md`](../archive/product/plan-legacy-2026-08.md)

## 1. 当前产品边界

MoonTide 是 Rust-first 的 native coding agent。当前实现由四个 crate 组成：

```text
cli → agent
       ├── agent-core
       └── agent-tools → agent-core
```

- `agent-core`：Turn、Session、Tool、Context、Event、LLM 等运行时契约；
- `agent-tools`：第一方工具 catalog 与 executor；
- `agent`：组合根和宿主 API；
- `cli`：参数、REPL、approval、诊断和最终输出。

当前产品开发从 CLI 宿主基线转向 Desktop Shell v0.1。Desktop 直接复用 `agent`，不复制 AgentLoop，不通过 CLI 子进程接入。

## 2. Desktop Shell v0.1

第一版固定为：

- 单窗口；
- 单活跃 Session；
- Turn 串行；
- 本地 Rust + Slint；
- Session Item Log 作为恢复事实源；
- Agent Event Log 和宿主 UI 事件作为观测流。

P0 能力：

1. assistant 流式 snapshot；
2. Turn/Step/Thinking/ToolCall/ToolResult UI 事件；
3. 工具 approval UI；
4. CancellationToken 取消和清理；
5. idle/thinking/tool/approval/error/completed 状态；
6. Session 创建、恢复和历史查询；
7. provider、工作目录、模型和密钥配置；
8. 错误展示和优雅关闭。

## 3. Coding 工作台 P1

- Session 列表、切换和 fork；
- ToolCall/ToolResult 详情；
- 文件变更摘要、diff 和文件打开；
- 显式重新执行上一 Turn；
- 工作目录和 `AGENTS.md` 状态；
- Thinking/trace 设置；
- 多行输入和输入历史。

## 4. 后置方向

以下能力不属于 Desktop v0.1：

- 多 Session 并发和后台队列；
- scheduler、多 Agent、delegate；
- sidecar、MCP 和跨进程 daemon；
- 本地模型 daemon；
- Remote Compute、SSH 远程模型和 GPU 租赁；
- compaction、memory、retrieval；
- Go services、Node extension 和跨设备同步。

它们只有在出现真实并发、资源、跨进程、上下文规模或生态消费者后重新进行架构对齐。

## 5. 权威关系

- 产品方向和范围见本文与 [`desktop-development-direction.md`](desktop-development-direction.md)；
- 当前执行优先级见根 [`../../TODO.md`](../../TODO.md)；
- Rust 系统 owner 和不变量见 [`../../crates/docs/agent-core.md`](../../crates/docs/agent-core.md)；
- 模块 API 和实现设计见对应源码目录 README/DESIGN；
- 历史 TypeScript 设计见 [`../archive/`](../archive/)，不参与当前实现裁决。
