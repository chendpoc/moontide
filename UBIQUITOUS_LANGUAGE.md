# Ubiquitous Language

> MoonTide agent 内核的领域术语收敛稿。来源：session 模块架构对齐中暴露的术语分裂（同一概念多个名字）。canonical 列 = 唯一推荐用词；「Aliases to avoid」= 历史名，禁止再写。

## Logs（日志与事实源）

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Session Item Log** | 整场 session 的 append-only 事实源（source of truth） | Session Event Log、SessionLog、session log、Item Log |
| **SessionItem** | Session Item Log 里的一条记录 | SessionEvent、SessionLogEntry、entry |
| **Agent Event Log** | 现有 `runId` 分区的观测日志（trace / metrics / tool use）；legacy `runId` 不代表 Run 实体 | TurnEvent log、观测流 |
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

## Execution lifecycle（执行生命周期）

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Turn** | 一次用户输入到一个终止 ModelResponse 或错误；UserMessage commit 后编号永久消费 | Run、request cycle |
| **Step** | Turn 内的一次逻辑 LLM 调用；retry attempts 仍属于同一 Step | LLM round、attempt |
| **Tool round** | 一个 ToolUse response 中全部 ToolCall 及其配对 ToolResult | batch、invocation group |
| **LLM attempt** | 同一 Step/ModelRequest 的一次传输尝试；每次有独立 llm_call_id | Step、Run |
| **AgentLoop** | 独占 SessionStore 并串行执行 Turn 的编排对象 | Run、runner context |

执行层级固定为 **Session → Turn → Step → Tool round**。**Run** 不是执行领域实体；现有 Agent Event `runId` 只是 legacy 观测分区字段。`trace_id` / `span_id` 属于未来 observability，不与 Turn identity 混用。

## Compose pipeline（编译流水线）

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **materialize** | Session Item Log → 内存 `messages[]`（唯一出口之一） | derive_messages、messagesFromItems、投影、还原 |
| **compile** | `SystemPrompt` + messages + tools → 本次 `ModelRequest`（唯一运行时构造出口） | compose、buildRequest |
| **derive** | TurnEvent → Agent Event（观测，不写回 Session Item Log） | project、mirror |
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
- **Agent Event Log** 可从 **Session Item Log** 通过 **derive** 派生或双写，但不得反向覆盖。
- **Compaction** 不删 **SessionItem**，只改 **materialize** 的消息选择规则；**Checkpoint** 保存恢复指针——二者独立。
- 一个 **ToolCall** 必须与恰好一个同身份 **ToolResult** 配对；event/session 不再复制它们的字段。
- 一个 **AgentLoop** 独占一个 **Session** runtime handle；同一实例通过 `turn(&mut self)` 串行执行多个 **Turn**。
- 一个 **Turn** 包含至多 `max_steps` 个 **Step**；Recoverable **LLM attempt** 重试不增加 Step。
- 一个 **Tool round** 的全部 ToolCall 在副作用前记录，全部 ToolResult 配对后才能进入下一 Step。

## Example dialogue

> **Dev：** 用户发来一句话，到模型收到请求，中间经过几个动作？
> **Domain expert：** 三个。先把这条用户输入 **append** 成一条 **SessionItem**（唯一写者落盘）；然后 **materialize** 把 **Session Item Log** 变成 model-visible `messages[]`；最后 **compile** 出本次 `ModelRequest`。
> **Dev：** **materialize** 和 **compile** 有什么区别？
> **Domain expert：** **materialize** 负责「事实 → model-visible 消息列表」，并拥有未来的 compaction、prune、retrieval 与 manifest；**compile** 只把 `SystemPrompt`、tools、messages 组装成请求。所以 materialize 是 context 模块的出口，compile 是 model_input 模块的出口，二者不能混用。
> **Dev：** 模型这轮的 trace 要记录，写进 **Session Item Log** 吗？
> **Domain expert：** 不。trace 写 **Agent Event Log**，用 **derive** 从 TurnEvent 派生，永远不反向覆盖 **Session Item Log**；当前 `runId` 只是 legacy 分区键。
> **Dev：** 历史太长要压缩，是把旧的 **SessionItem** 删掉吗？
> **Domain expert：** 不删。**Compaction** 只改后续 **materialize** 的消息选择；**Session Item Log** 保持 append-only，事实永远在。

## Flagged ambiguities

1. **「Session Event Log」一词两义** —— 归档的 `docs/archive/spec/agent-events.md` 里它是 Session Item Log 的同义词；`crates/docs/design/logging-and-session-design.md` 里 `SessionEvent` 指「含生命周期的条目 enum」。建议：废弃「Session Event Log」，统一 **Session Item Log**；生命周期事实归 **Agent Event Log**。
2. **条目三名词** —— `SessionEvent` / `SessionLogEntry` / `SessionItem` 指同一概念。统一 **SessionItem**。
3. **compose vs compile** —— 已裁决：统一 **compile**（对应 `model_input::compile()`）。`Context Composer` 是 TypeScript 历史称谓，不再作为 Rust 精确术语。
4. **还原四名词** —— `derive_messages` / `messagesFromItems` / `投影` / `还原` 指同一概念。统一 **materialize**（`AGENTS.md` 已定）。
5. **Instruction State vs SystemPrompt** —— 已裁决：来源解析由 `agent` 负责，解析结果统一叫 **SystemPrompt**；Rust 内核不建模 Instruction State。
6. **Run vs Turn vs trace** —— 已裁决：执行层没有 Run；一次用户交互叫 Turn，逻辑模型调用叫 Step，retry 叫 LLM attempt。legacy `runId` 仅为 Agent Event 分区键；未来 OTel trace/span 另行设计。
