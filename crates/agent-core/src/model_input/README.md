# model_input

> **对外使用说明** — 集成 `agent-core::model_input` 时读本文即可。
> **实现细节** — [`DESIGN.md`](DESIGN.md)
> **状态：** R1 Rust 实现与测试完成；等待 Review。

---

## 这是什么

`model_input` 是 `ModelRequest` 的**唯一运行时构造边界**。它把已经解析好的本轮输入组装为 provider-neutral 请求，不读取文件、不修改会话历史，也不执行 provider 兼容转换。

```text
ModelRequestConfig ─┐
SystemPrompt ───────┼──► model_input::compile ──► ModelRequest ──► llm
messages ───────────┤
ToolRegistry ───────┘
```

四类输入各有唯一来源：

| 输入 | 所有者 | `model_input` 的动作 |
|------|--------|----------------------|
| `ModelRequestConfig` | `agent` / turn config resolution | 复制模型调用参数 |
| `SystemPrompt` | `agent` / `resolveTurnContext` | 复制已解析的 system 内容 |
| `Vec<Message>` | `context::materialize` | 原样移动进请求 |
| `ToolRegistry` | `agent` 组合根 | 按 registry 稳定顺序映射 canonical schema |

---

## 公开 API

```rust
pub struct SystemPrompt {
    content: String,
}

impl SystemPrompt {
    pub fn new(content: impl Into<String>) -> Self;
    pub fn content(&self) -> &str;
}

pub struct ModelRequestConfig {
    pub model: String,
    pub max_tokens: u32,
    pub thinking_level: Option<ThinkingLevel>,
    pub session_id: Option<String>,
}

pub(crate) fn compile(
    config: &ModelRequestConfig,
    system_prompt: &SystemPrompt,
    messages: Vec<Message>,
    tool_registry: &ToolRegistry,
) -> ModelRequest;
```

`compile` 不返回 `Result`：

- `ToolSpec::new` 已校验 tool name，`ToolRegistry::new` 已校验重复项和 input schema；
- 空 system prompt 与空 tool 集合是合法输入；
- model、messages、max_tokens 等请求前置校验仍由 `llm` 单独负责。

---

## 生命周期

`SystemPrompt` 在每个 user turn 开始时解析一次，并在该 turn 内保持稳定。一次 turn 可以有多个 model step，因此 `compile` 会执行多次：

```text
resolve turn context
  → context.materialize
  → model_input.compile
  → model call
  → tool call/result
  → context.materialize
  → model_input.compile
  → model call
```

如果 tool 在 turn 中修改 `AGENTS.md`，新规则从下一个 user turn 生效；当前 turn 不重新解析 `SystemPrompt`。

---

## 边界

`model_input` 只依赖：

- `llm::protocol`
- `tools`

它不依赖 `agent`、`loop`、`context`、`session` 或 `event`。上层模块可以调用它，但不能反向成为其输入来源实现。

`SystemPrompt` 与 `ModelRequestConfig` 跨 crate 公开；`compile` 仅供同 crate 的 `loop` 调用，因此使用 `pub(crate)`，不向组合根或 CLI 暴露直接构造入口。

| 属于 `model_input` | 不属于 `model_input` |
|---------------------|------------------------|
| 组装 `ModelRequest` | 读取 `AGENTS.md` / skills / rules |
| `ToolSpec` → `ToolSchema` | session item → messages |
| 保留 tool 的稳定排序 | compaction / prune / summary / retrieval |
| 复制调用配置 | provider-specific JSON / 关键词兼容 |
| 原样消费 messages | model request preflight |

---

## context 的后续扩展接缝

R1 直接消费 `Vec<Message>`，不提前引入 manifest 或预算对象。未来 `context` 可以返回：

```rust
pub struct MaterializedContext {
    messages: Vec<Message>,
    manifest: ContextManifest,
}
```

由 `loop` 取出 `messages` 交给 `compile`；`manifest` 留给诊断、预算解释和事件记录。compaction、tail window、artifact、retrieval 与 working set 仍全部属于 `context`。

`context` 后续计算 message budget 时必须考虑 system 与 tools 的 pinned token 成本，但这不改变 `compile` 的 R1 参数，也不把 context policy 搬进本模块。

---

## 常见错误

| 做法 | 问题 |
|------|------|
| 在 loop 直接构造 `ModelRequest` | 绕过唯一构造边界，字段映射会分叉 |
| 在 `compile` 中读取规则文件 | 将解析生命周期和纯组装耦合 |
| 在 `compile` 中裁剪 messages | 侵入 `context` 的预算与历史语义 |
| 在 `compile` 中兼容某家 provider | 污染 provider-neutral 协议 |
| 每个 model step 重载 `SystemPrompt` | 同一 turn 的规则可能漂移 |

---

## 进一步阅读

- 模块不变量和 R1 设计：[`DESIGN.md`](DESIGN.md)
- 协议与 provider 边界：[`../llm/README.md`](../llm/README.md)
- tool registry 与 schema：[`../tools/README.md`](../tools/README.md)
