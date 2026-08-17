# Ubiquitous Language

> MoonTide agent 内核的领域术语收敛稿。来源：session 模块架构对齐中暴露的术语分裂（同一概念多个名字）。canonical 列 = 唯一推荐用词；「Aliases to avoid」= 历史名，禁止再写。

## Logs（日志与事实源）

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Session Item Log** | 整场 session 的 append-only 事实源（source of truth） | Session Event Log、SessionLog、session log、Item Log |
| **SessionItem** | Session Item Log 里的一条记录 | SessionEvent、SessionLogEntry、entry |
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
| **compile** | `SystemPrompt` + messages + tools → 本次 `ModelRequest`（唯一运行时构造出口） | compose、buildRequest |
| **model_input** | 纯组装 `ModelRequest` 的内核模块 | prompt、Context Composer、assembler |
| **Context Manifest** | materialize 的内容选择与预算说明；不进入 `ModelRequest` | manifest |

## Compaction & State Stores（压缩与状态库）

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Compaction** | 调整 materialize 结果以纳入 context 预算的操作（不删 SessionItem） | summarize |
| **CompactionSave** | summary / structured 压缩的持久产物 | compaction record（TS 遗留） |
| **Artifact Store** | 大 tool 输出全文的存储 | — |
| **SystemPrompt** | 每个 user turn 已解析、在该 turn 内稳定的 system 指令值 | Instruction State、ResolvedInstructions、InputPrompt |

## Tools（工具调用）

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **ToolCall** | 一次模型发起的工具调用事实：稳定 id、工具名与 input | ToolInvocation、ToolEvent |
| **ToolResult** | 对一个 ToolCall 的规范结果：相同身份、typed status 与 content | ToolOutcome、ToolOutput |
| **ToolCallRecorded** | TurnEvent 对 ToolCall 的直接包装，执行副作用前 commit | ToolInvocationRecorded |
| **ToolResultRecorded** | TurnEvent 对 ToolResult 的直接包装，结果确定后 commit | ToolOutcomeRecorded |

`ToolCall` / `ToolResult` 是单次调用生命周期仅有的两个结构体建模。SessionItem 和 TurnEvent 只包装它们；历史 v1 kind 仅用于兼容读取，不是当前术语。

## Relationships

- 一个 **Session** 拥有恰好一个 **SessionHeader** + 一份 **Session Item Log**。
- 一条 **SessionItem** 属于恰好一份 **Session Item Log**。
- **materialize** 读 **Session Item Log** → 产出 model-visible `messages[]`；**compile** 消费 `SystemPrompt`、`messages[]` 与 tool registry → 产出 `ModelRequest`。
- **Compaction** 不删 **SessionItem**，只改 **materialize** 的消息选择规则；**Checkpoint** 保存恢复指针——二者独立。
- 一个 **ToolCall** 必须与恰好一个同身份 **ToolResult** 配对；event/session 不再复制它们的字段。

## Example dialogue

> **Dev：** 用户发来一句话，到模型收到请求，中间经过几个动作？
> **Domain expert：** 三个。先把这条用户输入 **append** 成一条 **SessionItem**（唯一写者落盘）；然后 **materialize** 把 **Session Item Log** 变成 model-visible `messages[]`；最后 **compile** 出本次 `ModelRequest`。
> **Dev：** **materialize** 和 **compile** 有什么区别？
> **Domain expert：** **materialize** 负责「事实 → model-visible 消息列表」，并拥有未来的 compaction、prune、retrieval 与 manifest；**compile** 只把 `SystemPrompt`、tools、messages 组装成请求。所以 materialize 是 context 模块的出口，compile 是 model_input 模块的出口，二者不能混用。
> **Dev：** 模型这轮的运行观测要写进 **Session Item Log** 吗？
> **Domain expert：** 不。Session Item Log 只保存恢复和模型可见所需事实；观测协议与存储等真实接入时再设计。
> **Dev：** 历史太长要压缩，是把旧的 **SessionItem** 删掉吗？
> **Domain expert：** 不删。**Compaction** 只改下一轮 **compile** 的规则；**Session Item Log** 保持 append-only，事实永远在。

## Flagged ambiguities

1. **「Session Event Log」一词两义** —— 归档的 `docs/archive/spec/agent-events.md` 里它是 Session Item Log 的同义词；`crates/docs/logging-and-session-design.md` 里 `SessionEvent` 指「含生命周期的条目 enum」。建议：废弃「Session Event Log」，统一 **Session Item Log**；未来观测日志另行设计。
2. **条目三名词** —— `SessionEvent` / `SessionLogEntry` / `SessionItem` 指同一概念。统一 **SessionItem**。
3. **compose vs compile** —— 已裁决：统一 **compile**（对应 `model_input::compile()`）。`Context Composer` 是 TypeScript 历史称谓，不再作为 Rust 精确术语。
4. **还原四名词** —— `derive_messages` / `messagesFromItems` / `投影` / `还原` 指同一概念。统一 **materialize**（`AGENTS.md` 已定）。
5. **Instruction State vs SystemPrompt** —— 已裁决：来源解析由 `agent` 负责，解析结果统一叫 **SystemPrompt**；Rust 内核不建模 Instruction State。
