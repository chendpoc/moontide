# Ubiquitous Language

> MoonTide agent 内核的领域术语收敛稿。来源：session 模块架构对齐中暴露的术语分裂（同一概念多个名字）。canonical 列 = 唯一推荐用词；「Aliases to avoid」= 历史名，禁止再写。

## Logs（日志与事实源）

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Session Item Log** | 整场 session 的 append-only 事实源（source of truth） | Session Event Log、SessionLog、session log、Item Log |
| **SessionItem** | Session Item Log 里的一条记录 | SessionEvent、SessionLogEntry、entry |
| **Agent Event Log** | 单次 run 的观测日志（trace / metrics / tool use） | RunEvent log、观测流 |
| **SessionHeader** | 外置元数据（`.meta.json`），非可重放事件 | meta、header |
| **Logger** | 可丢弃的运行时诊断流（stderr） | diagnostics log、日志文件 |

## Session lifecycle（会话生命周期）

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Session** | 一场会话：一个 SessionHeader + 一份 Session Item Log 的句柄 | AgentSession（TS 遗留） |
| **append** | 唯一写者动作：校验 → 冻结 → 落盘一条 SessionItem | write、push |
| **resume** | 读 header → 逐条重放校验 → 恢复游标 | load、restore |
| **fork** | 在 turn 边界复制 log 前缀，产生新 session | branch、clone |
| **Checkpoint** | 某 turn 的可恢复快照（与 Compaction 正交） | snapshot |

## Compose pipeline（编译流水线）

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **materialize** | Session Item Log → 内存 `messages[]`（唯一出口之一） | derive_messages、messagesFromItems、投影、还原 |
| **compile** | Session 状态 → 本轮 `LLMRequest` + Context Manifest（唯一出口之一） | compose、buildRequest |
| **derive** | RunEvent → Agent Event（观测，不写回 Session Item Log） | project、mirror |
| **Context Composer** | 组装各切片、按固定顺序 compile 的唯一模块 | composer、assembler |
| **Context Manifest** | 本轮 compile 的决策与预算说明 | manifest |

## Compaction & State Stores（压缩与状态库）

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Compaction** | 调整 compile 规则以纳入 context 预算的操作（不删 SessionItem） | summarize |
| **CompactionSave** | summary / structured 压缩的持久产物 | compaction record（TS 遗留） |
| **Artifact Store** | 大 tool 输出全文的存储 | — |
| **Instruction State** | 拼进 `system` 的规则来源（AGENTS.md / rules） | rules、prompt state |

## Relationships

- 一个 **Session** 拥有恰好一个 **SessionHeader** + 一份 **Session Item Log**。
- 一条 **SessionItem** 属于恰好一份 **Session Item Log**。
- **materialize** 读 **Session Item Log** → 产出 `messages[]`；**compile** 消费 `messages[]` → 产出 `LLMRequest` + **Context Manifest**。
- **Agent Event Log** 可从 **Session Item Log** 通过 **derive** 派生或双写，但不得反向覆盖。
- **Compaction** 不删 **SessionItem**，只改 **compile** 规则；**Checkpoint** 保存恢复指针——二者独立。

## Example dialogue

> **Dev：** 用户发来一句话，到模型收到请求，中间经过几个动作？
> **Domain expert：** 三个。先把这条用户输入 **append** 成一条 **SessionItem**（唯一写者落盘）；然后 **materialize** 把整份 **Session Item Log** 还原成 `messages[]`；最后 **compile** 出本轮 `LLMRequest` + **Context Manifest**。
> **Dev：** **materialize** 和 **compile** 有什么区别？
> **Domain expert：** **materialize** 只负责「事实 → 消息列表」，不含 system 和 tools；**compile** 把 system、tools、messages 全部组装成发给模型的请求。所以 materialize 是 context 模块的出口，compile 是 prompt 模块的出口，二者不能混用。
> **Dev：** 模型这轮的 trace 要记录，写进 **Session Item Log** 吗？
> **Domain expert：** 不。trace 是 run 级观测，写 **Agent Event Log**，用 **derive** 从 RunEvent 派生，永远不反向覆盖 **Session Item Log**。
> **Dev：** 历史太长要压缩，是把旧的 **SessionItem** 删掉吗？
> **Domain expert：** 不删。**Compaction** 只改下一轮 **compile** 的规则；**Session Item Log** 保持 append-only，事实永远在。

## Flagged ambiguities

1. **「Session Event Log」一词两义** —— `docs/spec/agent-events.md` 里它是 Session Item Log 的同义词；`crates/docs/logging-and-session-design.md` 里 `SessionEvent` 指「含生命周期的条目 enum」。建议：废弃「Session Event Log」，统一 **Session Item Log**；生命周期事实归 **Agent Event Log**。
2. **条目三名词** —— `SessionEvent` / `SessionLogEntry` / `SessionItem` 指同一概念。统一 **SessionItem**。
3. **compose vs compile** —— 已裁决：统一 **compile**（对应已落地函数 `prompt.compile()`）。`AGENTS.md` 术语表已改；「compose」仅作 Context Composer 的泛称，不作精确术语。
4. **还原四名词** —— `derive_messages` / `messagesFromItems` / `投影` / `还原` 指同一概念。统一 **materialize**（`AGENTS.md` 已定）。
