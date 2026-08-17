# MoonTide 产品实现计划

> 完整 TODO：[`TODO.md`](../../TODO.md) · Doc Map：[`docs/README.md`](../README.md)

## 当前主线

Rust Agent Core 先完成可恢复执行闭环：Session → Turn → Step → Tool round。Session Item Log 是当前唯一持久事实源；event 只负责把 Turn 事实同步提交给 session。

## Observability（后置）

当前不定义：

- Agent Event Log 或观测 JSONL schema；
- trace/span identity 与 OTel 映射；
- 实时 UI event、bus、sidecar bridge；
- 观测文件路径、轮转、压缩、retention、replay；
- privacy、redaction 或 exporter。

出现真实 UI、诊断或 OTel 接入方后，先重新完成架构对齐，再决定事件内容、失败隔离、存储和生命周期。不得把归档 TypeScript 方案当作当前 Rust 契约。
