# schema

跨语言契约的单一真理源：Rust 内核、Go 后台服务与 Node 扩展共享的 wire format。

## 定位

| 属于这里 | 不属于这里 |
|---|---|
| 跨进程 / 跨语言传输的 JSON Schema（session item、tool call） | 单一语言内部的类型定义（如 `TurnEvent`） |
| 版本化的协议契约与兼容规则 | 实现细节、默认值推导逻辑 |

只有当一个契约**至少被两种语言消费**时才落到这里；单语言契约留在对应 crate 内，避免过早抽象。

## 状态

空目录（占位）。首个 schema 的落地条件见 [`../docs/notes/runtime/agent-kernel-architecture.md`](../docs/notes/runtime/agent-kernel-architecture.md)。
