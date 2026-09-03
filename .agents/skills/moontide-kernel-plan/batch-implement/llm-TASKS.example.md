# llm 子任务示例（deprecated — 现用 GitHub Issue body）

> **状态：** deprecated。实现跟踪改为 GitHub Issue + Review 批，不再维护 `src/llm/TASKS.md`。
> 契约：[`src/llm/README.md`](../../../../crates/agent-core/src/llm/README.md) · 实现范围：[`agent-core/DESIGN.md`](../../../../crates/agent-core/DESIGN.md#llm)
> **条目：** **做什么**（1–3 句）+ 依赖 + 范围 + 预估 + 完成标准。见 [`batch-implement/SKILL.md`](SKILL.md)。

## 批次建议

| 批 | TASK | 预估 diff | 说明 |
|----|------|-----------|------|
| 1 | 01 | ~80 | crate scaffold |
| 2 | 02 | ~350 | protocol |
| … | … | … | openai_chat normalize **逐 TASK 分批**，勿 05–07 合并 |
| 10 | 10 | ~600 | openai_chat adapter 单独一批 |

---

### TASK-llm-01: {标题}

- **做什么：** …
- **依赖：** 无
- **范围：** …
- **预估 diff：** ~80
- **完成标准：** …
- **状态：** ☐

### TASK-llm-02: protocol 类型

- **依赖：** 01
- **范围：** `src/llm/protocol/{mod,message,request,delta,error}.rs`
- **完成标准：** 类型与 DESIGN §6 一致；`cargo test -p agent-core protocol`（serde round-trip 若有）
