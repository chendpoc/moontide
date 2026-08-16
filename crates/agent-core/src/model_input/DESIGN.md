# model_input — 内部设计

> **状态：** 设计已确认；本文是 R1 实现契约。
> **公开用法：** [`README.md`](README.md)

---

## 1. 职责

`model_input` 是一个窄的纯组装模块：消费上游已经解析、选择和物化的数据，产出一次 provider-neutral `llm::protocol::ModelRequest`。

它只负责三件事：

1. 表达稳定的 system prompt 值；
2. 收拢一次 model request 的调用配置；
3. 以唯一规则组装 config、system、messages 与 tool schemas。

这里的 **compile** 指结构编译，不指 prompt 文本生成、context 压缩或 provider 编码。

---

## 2. 非职责

以下能力明确留在相邻模块：

| 能力 | 所有者 |
|------|--------|
| 解析 `AGENTS.md`、rules、skills、工作目录信息 | `agent` / turn context resolution |
| Session Item Log → model-visible messages | `context::materialize` |
| tail window、compaction、prune、summary、artifact、retrieval | `context` |
| tool 注册、schema 校验、executor 绑定 | `tools` |
| model/messages/max_tokens 请求前置校验 | `llm` |
| provider wire 转换与已确认的关键词兼容 | `llm` adapter |
| 调用顺序、tool loop、事件发射 | `loop` |

本模块不引入 trait、builder、`ModelInput`、`CompileContext`、instruction section 或第二份 tool/config 模型。

---

## 3. 依赖方向

```text
agent ────────┐
context ──────┼──► loop ──► model_input ──► llm::protocol
tools ────────┘                    │
                                  └──────► tools
```

允许的内部 import：

```text
model_input ──► llm::protocol
model_input ──► tools
```

禁止 `model_input` import `agent`、`loop`、`context`、`session` 或 `event`。这些模块的生命周期和策略不能泄漏进纯组装边界。

---

## 4. 公开模型

### 4.1 `SystemPrompt`

```rust
pub struct SystemPrompt {
    content: String,
}

impl SystemPrompt {
    pub fn new(content: impl Into<String>) -> Self;
    pub fn content(&self) -> &str;
}
```

`SystemPrompt` 是已经解析完成的值，不保留来源路径、section、优先级或 reload 状态。空内容合法。

类型存在的意义是固定语义边界：调用者必须传入“本 turn 已解析的 system prompt”，不能把任意 `String` 的用途留给参数位置猜测。

### 4.2 `ModelRequestConfig`

```rust
pub struct ModelRequestConfig {
    pub model: String,
    pub max_tokens: u32,
    pub thinking_level: Option<ThinkingLevel>,
    pub session_id: Option<String>,
}
```

该结构只收拢 `ModelRequest` 中由运行配置解析出的字段。它不重复 `system`、`messages` 或 `tools`，也不拥有 provider endpoint、API key、permission 或 working directory。

### 4.3 `compile`

```rust
pub(crate) fn compile(
    config: &ModelRequestConfig,
    system_prompt: &SystemPrompt,
    messages: Vec<Message>,
    tool_registry: &ToolRegistry,
) -> ModelRequest;
```

参数设计：

- config 与 system 按引用读取，允许同一 turn 的多次 compile 复用；
- messages 按值接收并直接移动，避免无意义复制；
- registry 按引用读取，保证 schema 和本 step 可执行工具来自同一冻结快照；
- 返回 `ModelRequest`，不增加无失败路径的 `Result`。

`SystemPrompt` 与 `ModelRequestConfig` 由上层 `agent` 构造，因此跨 crate 公开；`compile` 的 runtime caller 只有同 crate 的 `loop`，必须保持 `pub(crate)`。

---

## 5. 编译算法

`compile` 按固定映射构造请求：

```text
ModelRequest.model          ← clone(config.model)
ModelRequest.system         ← clone(system_prompt.content)
ModelRequest.messages       ← move(messages)
ModelRequest.tools          ← registry.iter().map(spec_to_schema)
ModelRequest.max_tokens     ← config.max_tokens
ModelRequest.thinking_level ← config.thinking_level
ModelRequest.session_id     ← clone(config.session_id)
```

其中 tool 映射严格为：

```text
ToolSchema.name         ← clone(ToolSpec.name)
ToolSchema.description  ← clone(ToolSpec.description)
ToolSchema.input_schema ← clone(ToolSpec.input_schema)
```

不增加、删除或重写 JSON Schema 关键词。`ToolRegistry` 已按 name 排序，因此生成的 `tools` 顺序稳定；不得在 `compile` 中再次排序或改用无序 map。

---

## 6. 生命周期

### 6.1 turn 边界

组合根在一个 user turn 开始时运行 `resolveTurnContext`，解析一次 `SystemPrompt`、`ModelRequestConfig` 和该 turn 需要的其他稳定输入。

`SystemPrompt` 在整个 turn 内 immutable。即使 tool 修改规则文件，当前 turn 也不 reload；修改从下一个 user turn 生效。这保证一个 tool loop 中各 model step 的规则一致。

### 6.2 step 边界

每次 model call 前都重新调用 `compile`。原因是 messages 会在 assistant/tool 交互后变化，而 config、system 与冻结 registry 可以复用。

```text
user turn
  ├── resolve SystemPrompt once
  ├── materialize → compile → model step 1
  ├── append tool interaction
  └── materialize → compile → model step 2
```

---

## 7. context 接缝

R1 的 `messages: Vec<Message>` 是有意保持的小接口。`model_input` 假设 messages 已经是 model-visible 结果，不执行 materialize、compaction 或语义改写。

未来 context 可将返回值扩展为：

```rust
pub struct MaterializedContext {
    messages: Vec<Message>,
    manifest: ContextManifest,
}
```

调用流仍然是：

```text
context::materialize → loop 取得 messages → model_input::compile
                                  └─────── manifest → diagnostics/event
```

因此 manifest 不需要成为 `compile` 参数。它描述 context 如何选择内容，不是 `ModelRequest` 的协议字段。

context 的 token budget 后续必须扣除 system 与 tools 的 pinned 成本，才能决定 messages 可用预算。该约束属于 context 模块设计；R1 不为此预设 `BudgetContext` 或 token counter trait。

---

## 8. 校验与错误边界

`compile` 是 infallible 的结构映射：

| 输入情况 | 行为 |
|----------|------|
| 空 `SystemPrompt` | 正常生成空 `system` |
| 空 `ToolRegistry` | 正常生成空 `tools` |
| 空 `messages` | 正常 compile；`llm` preflight 拒绝 |
| 空 model | 正常 compile；`llm` preflight 拒绝 |
| `max_tokens == 0` | 正常 compile；`llm` preflight 拒绝 |
| 非法 tool schema | 无法进入；`ToolRegistry::new` 已拒绝 |

不得在 `compile` 复制 `llm` preflight，也不得把 `ToolRegistry` 的结构不变量改成热路径 runtime assert。

---

## 9. R1 文件边界

目标实现保持小而直接：

```text
model_input/
├── README.md
├── DESIGN.md
├── mod.rs
├── compile.rs
└── tests.rs
```

- `mod.rs`：公开类型与 re-export；
- `compile.rs`：纯映射实现；
- `tests.rs`：结构不变量和边界用例。

不为两个简单 value type 拆更多文件，也不抽象通用 compiler trait。

---

## 10. R1 测试契约

实现阶段至少覆盖：

1. config、system、messages 全字段映射正确；
2. tool schema 完整复制且顺序与 registry 一致；
3. messages 按原顺序、原内容进入请求；
4. 空 system 与空 registry 可以 compile；
5. 空 model、空 messages 与零 max_tokens 分别可以 compile，证明本模块不复制 llm preflight；
6. 同一 config/system/registry 可用于同一 turn 的多次 compile，结果只随 messages 变化。

每个测试按仓库约束写清测试场景、预期结果和不变量/副作用边界。

“每 user turn 只解析一次 `SystemPrompt`”和“runtime 不绕过 `compile`”属于未来 loop/conformance 集成测试；本模块单测只证明值可复用和映射不改写。

---

## 11. 决策记录

| 决策 | 理由 |
|------|------|
| 模块名使用 `model_input` | 描述产物边界，避免把职责误解为 prompt 文本拼接 |
| `SystemPrompt` 而非 `InstructionState` | 模块只消费解析结果，不拥有 instruction 来源状态 |
| 不引入 `ResolvedInstructions` / `InputPrompt` | 前者暴露解析过程，后者无法表达完整 ModelRequest 输入 |
| `compile` 使用四个直观参数 | 参数角色稳定且数量可控；额外 context object 只会隐藏依赖 |
| `compile` 使用 `pub(crate)` | 唯一 runtime caller 是同 crate 的 loop；对外只暴露组合所需值类型 |
| `compile` 不返回 `Result` | 当前映射没有本模块拥有的失败条件 |
| messages 原样消费 | 语义 shaping 由 context 唯一拥有 |
| tool schema 轻量精确映射 | canonical schema 来自 registry；provider 兼容留给 adapter |
| SystemPrompt 每 turn 解析一次 | 防止同一 turn 的多 step 规则漂移 |
