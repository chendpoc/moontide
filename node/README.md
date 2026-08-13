# node

Node 扩展生态预留位：MCP server、插件包与需要 npm 生态的适配层。

## 定位

Node 只承担扩展与生态兼容，不承担内核职责。内核、推理与 CLI 在 Rust（[`../crates/`](../crates/)），
跨语言契约在 [`../schema/`](../schema/)。

## 状态

空目录（占位）。pnpm workspace 与首个扩展包后置到扩展生态真实落地时再建 —— 决策见
[`../docs/notes/runtime/agent-kernel-architecture.md`](../docs/notes/runtime/agent-kernel-architecture.md)。
