# Loop 统一消费 LLM 事件流重构需求

> **文档性质：** Plan  
> **状态：** Candidate，待架构评审  
> **范围：** `agent-core::llm` / `agent-core::loop` 的单次模型调用接缝  
> **关联：** [`agent-core.md`](agent-core.md) · [`../agent-core/src/llm/DESIGN.md`](../agent-core/src/llm/DESIGN.md) · [`../agent-core/src/loop/DESIGN.md`](../agent-core/src/loop/DESIGN.md)  
> **非目标：** 本文不立即改变当前 Rust 契约，不涉及 provider adapter、HTTP/SSE 协议或 ToolRuntime 语义。

## 背景

当前 `AgentLoop` 通过 `llm::run_model_call_with_updates` 调用模型：

```text
AgentLoop
  → run_model_call_with_updates
    → provider.stream
    → ModelResponseBuilder
    → on_update(snapshot)
      → AgentLoop.emit(MessageUpdate)
```

这种回调式接缝隐藏了部分控制流。阅读和维护一个 Turn 时，需要在
`AgentLoop`、`run_model_call_with_updates` 与 `on_update` 闭包之间切换，
并额外确认回调内部的事件提交错误是否被处理。

当前实现中的一个具体风险是，`AgentLoop` 的 `on_update` 闭包忽略了
`EventDispatcher::emit` 的返回错误。这样会导致流继续完成，而
`MessageUpdate` 的提交或持久化失败被吞掉。

## 需求动机

对于承担完整 Turn 生命周期的 `AgentLoop`，希望在同一控制流中清楚地看到：

```text
LlmCallStarted
  → 消费 ModelStreamEvent
  → MessageUpdate
  → ModelResponseBuilder
  → LlmCallEnded
  → Terminal / ToolRound
```

需要精确处理：

- LLM stream 的取消；
- `MessageUpdate` 或其他 TurnEvent 提交失败；
- `Finished` 缺失、工具调用未闭合等流结束错误；
- ToolUse response 之后继续 Tool round，或正常结束当前 Turn。

该需求的目标不是消除所有抽象，而是把 AgentLoop 的业务生命周期控制集中
到一个可读、可审查的控制流中。

## 已记录的重构方向

1. `run_model_call` 重命名为 `complete_response`，明确表示“消费一次完整
   的模型流并返回最终 `ModelResponse`”。
2. 采用 **loop-owned stream**：`AgentLoop` 直接消费
   `LLMProvider::stream()` 返回的 provider-neutral `ModelStreamEvent`，
   并在 loop 中统一产生 `TurnEvent`。
3. 在 `AgentLoop` 内使用 `consume_stream_event` 作为单个
   `ModelStreamEvent` 的处理入口：

   ```text
   AgentLoop 的 stream 消费循环
     → stream.next()
     → consume_stream_event(event)
       → ModelResponseBuilder::apply(event)
       → emit(MessageUpdate(snapshot))
   ```

   `consume_stream_event` 表示处理单个事件；完整 stream 的消费仍由
   `AgentLoop` 的显式循环负责，避免用该名称掩盖整个 stream 的生命周期。

## 当前契约冲突

当前 `crates/agent-core/src/llm/README.md` 规定：

```text
loop → 使用 run_model_call*
loop → 不 match ModelStreamEvent，不自写 fold
```

当前 `crates/agent-core/src/loop/README.md` 也将
`run_model_call*` 作为 LLM 接缝。因此本需求如果落地，将改变现有模块契约，
必须经过架构评审，不能在实现阶段静默修改。

## 建议方向

允许 `AgentLoop` 消费 **provider-neutral** 的模型事件，但不允许它接触
provider-specific 的传输细节：

```text
adapter
  → HTTP / SSE / provider JSON
  → ModelStreamEvent

AgentLoop
  → provider.stream()
  → ModelStreamEvent
  → ModelResponseBuilder
  → MessageUpdate / LlmCallEnded / Tool events
```

明确禁止：

```text
AgentLoop → HTTP bytes
AgentLoop → SSE decoder
AgentLoop → OpenAI / Anthropic wire event
```

## 目标控制流

单个 LLM Step 的目标逻辑：

```text
1. 创建 ModelResponseBuilder
2. 调用 provider.stream(request)
3. 在 AgentLoop 中消费 ModelStreamEvent
4. 对每个事件调用 builder.apply
5. 发送 MessageUpdate(snapshot)
6. 任一事件提交失败，立即停止并传播错误
7. 收到 stream EOF 后调用 builder.finish
8. 没有 Finished 时返回 LLM 协议错误
9. 发送 LlmCallEnded
10. classify_response
11. Terminal → AssistantFinalized → TurnEnded
12. ToolRound → 执行工具 → 下一 Step
```

`ModelResponseBuilder` 仍属于 `llm`，负责唯一的流事件 fold；
`AgentLoop` 只负责消费其输入、发送 TurnEvent 和推进 Turn 状态机。
重构不得在 loop 中复制一套 builder 聚合逻辑。

## 候选 API

### 方案 A：直接暴露现有 provider stream

```rust
let mut builder = ModelResponseBuilder::new(request.model.clone());
let mut stream = provider.stream(request);
```

优点：

- 控制流最直接；
- 取消、事件提交错误和 stream 结束状态在 loop 中可见；
- 不再需要 `on_update` 闭包。

代价：

- `loop` 需要依赖 `ModelStreamEvent` 和 `ModelResponseBuilder`；
- 需要重新确认 `llm` README 中的 fold 唯一性边界；
- loop 对 LLM 的流式实现细节承担更多维护责任。

### 方案 B：由 `llm` 暴露可逐步消费的 `ModelCallStream`

```rust
pub struct ModelCallStream {
    // provider stream + ModelResponseBuilder
}

impl ModelCallStream {
    pub async fn next_update(
        &mut self,
    ) -> Result<Option<ModelResponseSnapshot>, LlmError>;

    pub fn finish(self) -> Result<ModelResponse, LlmError>;
}
```

优点：

- loop 可以显式消费 update；
- `ModelResponseBuilder` 和 provider stream 仍封装在 `llm`；
- 取消与事件错误可以由 loop 自己控制。

代价：

- 增加新的 LLM 接缝类型；
- `ModelStreamEvent` 仍可能不直接暴露给 loop；
- 需要定义 `next_update` 与 `finish` 的状态不变量。

### 初步建议

如果需求重点是“所有 TurnEvent 由 loop 统一产生”，优先评审方案 A；
如果希望保持 `llm` 对聚合状态的强封装，评审方案 B。

无论选择哪种方案，都不应让 CLI 或 Desktop 直接消费 `ModelStreamEvent`。

## 错误与取消语义

重构必须保持以下不变量：

- `provider.stream` 返回的每个 `LlmError` 都传播到当前 LLM attempt；
- `MessageUpdate` 的提交错误不得被忽略；
- stream 未产生 `Finished` 时，不能生成成功的 `ModelResponse`；
- 工具调用尚未闭合时，不能进入下一 Step；
- LLM attempt 被取消时，按现有 retry/cancellation 规则结束该 attempt；
- partial snapshot 只能作为 Agent Event，不能写入 Session Item Log；
- 已经成功提交的最终 assistant 事实不被晚到的取消覆盖。

## 预计修改范围

候选修改范围：

- `crates/agent-core/src/llm/provider.rs`
  - 删除或重定位 callback-oriented helper；
  - 或增加 `ModelCallStream` 接缝；
- `crates/agent-core/src/loop/agent_loop.rs`
  - 在单个 Step 内显式消费 provider-neutral stream；
  - 统一处理 `MessageUpdate` 与流结束错误；
- `crates/agent-core/src/llm/README.md`
  - 更新 loop 调用契约和禁止项；
- `crates/agent-core/src/loop/README.md`
  - 更新 Step 的 LLM 接缝和错误语义；
- `crates/agent-core/src/llm/tests.rs`
  - 补充 Finished 缺失、未闭合 ToolUse、取消和流事件顺序测试；
- `crates/agent-core/src/loop/tests.rs`
  - 补充 MessageUpdate 提交失败和完整 TurnEvent 顺序测试。

## 非目标

- 不改变 `LLMProvider` 的 provider-neutral 事件语义；
- 不让 loop 处理 SSE、HTTP 或厂商 wire JSON；
- 不改变 `ToolCall`、`ToolResult` 或 ToolRuntime 的执行语义；
- 不改变 Session Item Log 的事实源和唯一写入路径；
- 不增加新的 Run 实体；
- 不在本需求中引入 Agent 层公共 `stream()` API；
- 不同步照搬 Pi 的 `streamSimple` 命名。

## 验收标准

重构获批并实现后，至少满足：

```text
一次 LLM Step 的 stream 消费、snapshot 更新、
LlmCallEnded 和错误传播，在 AgentLoop 的单一控制流中可追踪。
```

- 所有 `TurnEvent` 由 `AgentLoop` 统一产生；
- `MessageUpdate` 提交失败不会被吞掉；
- `Finished` 缺失会明确失败；
- ToolUse 未闭合会明确失败；
- 取消不会留下无法配对的 ToolCall / ToolResult；
- provider-specific HTTP/SSE 类型不会进入 `AgentLoop`；
- CLI / Desktop 仍只消费 AgentEvent 或 `ModelResponseSnapshot`；
- 单次模型调用仍只有一个 `ModelResponseBuilder` fold 实现；
- 现有 `cargo test -p agent-core` 与 `just check` 通过。

## 后续决策

实现前需要明确：

1. 方案 A 是否正式替代方案 B；
2. `ModelStreamEvent` 是否成为 `loop` 对 `llm` 的稳定内部依赖；
3. `complete_response` 是否保留为仅返回最终结果的便利函数；
4. 是否将该重构纳入现有 F1/F2 Task，还是独立建立 Task；
5. 是否需要先更新 `llm/README.md` 和 `loop/README.md`，再进入实现。
