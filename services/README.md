# services

Go 实现的后台服务预留位：常驻监控、代理与调度类进程。

## 定位

Go 承担「长时间运行、IO 密集、与内核解耦」的后台职责；Agent 内核、推理与 CLI 留在 Rust（[`../crates/`](../crates/)）。

## 状态

空目录（占位）。`go.mod` 与首个 service 后置到真实需求出现时再建，不预先搭骨架 —— 决策见
[`../docs/notes/runtime/agent-kernel-architecture.md`](../docs/notes/runtime/agent-kernel-architecture.md)。
