# Runtime 与平台候选路线

> **性质：** Candidate roadmap
> **状态：** Candidate / Deferred；当前 Runtime 契约见 [`../../../crates/docs/agent-core.md`](../../../crates/docs/agent-core.md)
> **来源：** 旧 TODO 的跨语言、扩展、Local Fusion、网络可达性和多 Agent 条目

## Candidate

### 跨语言契约

- Agent Event、Session Item 和 ToolCall 的版本化 JSON Schema；
- Rust 类型与 schema 的生成或结构断言；
- 只有出现第二个语言或进程消费者时，才落地 `schema/`。

### 扩展与进程边界

- MCP client/server；
- sidecar hook 和进程隔离；
- Node extension runtime；
- Go 后台监控、代理或调度服务；
- extension request pipeline：需求澄清 → brief → review → judge。

相关候选设计：[`../../../crates/docs/extension-request-pipeline.md`](../../../crates/docs/extension-request-pipeline.md)、[`../../../crates/docs/extension-sidecar-runtime.md`](../../../crates/docs/extension-sidecar-runtime.md)。

### 本地模型与路由

- 常驻本地模型 daemon；
- Local Fusion / Model Router；
- 可验证任务的本地快路径和云端 failover；
- 本地模型 catalog、下载、版本和资源策略。

### 网络可靠性

- 外网不可达的明确错误分类；
- 镜像、代理、本地缓存和离线替代路径；
- 工具超时、有限重试和降级提示；
- 国内网络条件下的 provider、依赖和文档访问体验。

## Deferred

- scheduler、多 Agent、delegate、后台队列和多 Session 并发；
- sidecar、Go、Node 和跨进程 schema；
- 本地模型 daemon，直到宿主契约和真实性能需求稳定。

## 进入条件

- 必须有真实消费者或第二进程；
- 必须先完成 owner、权限、取消、恢复和协议版本设计；
- 不通过扩大 Hook 或在 `agent-core` 内提前堆放未来实现来占位。
