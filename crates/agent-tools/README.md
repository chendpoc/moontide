# agent-tools

> **性质：** 第一方工具库的对外使用说明。
> **状态：** R1 已实现；静态 catalog 当前包含 `read`、`write`、`edit`、`find`、`grep`、`bash`。
> **运行时契约：** [`../agent-core/src/tools/README.md`](../agent-core/src/tools/README.md)。
> **实现细节：** [`DESIGN.md`](DESIGN.md) · **实现批次：** [`TASKS.md`](TASKS.md)。

---

## 这是什么

`agent-tools` 存放 MoonTide 自带的具体工具，例如 `read`、`write`、`edit`、`find`、`grep` 和 `bash`。它负责“有哪些第一方工具、每个工具如何构造”，不拥有运行时调用管线。

```text
agent-tools                         agent-core::tools
───────────                         ─────────────────
ToolDefinition                     ToolSpec
builtin_tool_definitions()   build Tool + ToolExecutor
read / write / edit / find / grep   ToolRegistry
 / bash
                                    ToolCall / ToolResult
```

三个名称容易混淆，固定含义如下：

| 类型 | 含义 | 是否已实例化 |
|------|------|--------------|
| `ToolDefinition` | 第一方 catalog 中的一条静态“名称 + 构造配方” | 否 |
| `Tool` | `ToolSpec` 与一个 executor 的运行时绑定 | 是 |
| `ToolRegistry` | 当前 LLM step 使用的 frozen `Vec<Tool>` | 是 |

`agent-tools` 只提供前两者之间的 build 边界；不会再实现第二套 registry。

---

## 依赖方向

```text
cli → agent（组合根）
       ├──► agent-core
       └──► agent-tools ──► agent-core
```

- `agent-tools` 依赖 `agent-core::tools` 的公开契约；
- `agent-core` 永不依赖 `agent-tools`；
- `agent` 按 preset 的 tool names 选择 definition、build `Vec<Tool>`，再创建 `ToolRegistry`；
- permission map 也由 `agent` 声明，`agent-tools` 不决定 `Allow` / `Ask`。

这条依赖保证内核可以被测试工具、MCP 工具或 sidecar executor 复用，而不被第一方 builtin 反向绑死。

---

## 公开接口

首版只公开一个静态 definition 类型和一个 catalog 函数：

```rust
pub struct ToolDefinition {
    // private: name + zero-argument build function
}

impl ToolDefinition {
    pub fn name(&self) -> &'static str;
    pub fn build(&self) -> anyhow::Result<agent_core::tools::Tool>;
}

pub fn builtin_tool_definitions() -> &'static [ToolDefinition];
```

约束：

- 字段私有，外部不能替换 name 或 builder；
- catalog 是编译期静态表，按 name 稳定排序且无重复项；
- `build()` 必须验证产出的 `Tool::spec().name()` 与 definition name 相同；
- build 只组装 spec/executor，不读取文件、不发网络请求、不启动子进程；
- 新增 builtin 的正常路径是增加一个高内聚模块，再在 catalog 增加一行；不修改长 `match`；
- 首版不增加 `ToolLibrary`、外部 TOML/JSON manifest、通用 build context、宏注册系统或动态插件加载。

组合根的选择逻辑保持显式：

```text
preset.tools = ["grep"]
  → 在 builtin_tool_definitions() 中按 name 查找
  → definition.build()
  → Vec<Tool>
  → ToolRegistry::new(tools)
```

未知 preset name 是组合配置错误，不能被静默忽略。

---

## builtin 组织规则

每个 builtin 是一个内部模块，并继续遵守 spec / impl 分离：

```text
src/grep/
  mod.rs       # 只绑定 spec 与 executor
  spec.rs      # ToolSpec / input schema；无 IO
  executor.rs  # 文件 IO；不定义 schema、不决定 permission
```

不同 builtin 可以有不同内部结构；不为减少几行重复抽取通用 handler 框架。共同的运行时多态只经 `ToolExecutor` 表达。

---

## Builtin 工具

### `find`

`find` 只按 glob 搜索文件路径，不读取文件内容：

```json
{
  "pattern": "**/*.rs",
  "path": "crates",
  "max_results": 100
}
```

- 结果是相对 `working_dir` 的文件路径；
- 目录递归搜索遵守 `.ignore` / `.gitignore`，不跟随 symlink；
- 路径、结果数量和 glob 都在 executor 内校验；
- 没有匹配时返回 `Succeeded("No files found.")`。

### `grep`

`grep` 是 catalog 的 tracer bullet：它能同时验证声明式 definition、spec / executor 分离、`working_dir` 语义和有界 tool result，但不引入 shell 或网络权限问题。

### 输入

```json
{
  "pattern": "ToolRegistry::new",
  "path": "crates",
  "max_results": 100
}
```

| 字段 | 必填 | 语义 |
|------|------|------|
| `pattern` | 是 | Rust `regex` 语法；不能为空 |
| `path` | 否 | 相对 `working_dir` 的文件或目录；默认 `.` |
| `max_results` | 否 | 最大匹配行数，默认 100，范围 1–1000 |

首版不再增加 `case_sensitive`、`fixed_string`、context lines 或多 glob 参数；需要忽略大小写时可使用正则内联 flag，例如 `(?i)tool`。

### 文件边界

- 相对路径以调用时传入的 `working_dir` 解析；不读取或修改进程全局 cwd；
- target canonicalize 后必须位于 canonical working directory 内；绝对路径也必须满足同一约束；
- 搜索目录时遵守 `.ignore` / `.gitignore` 等标准 ignore 规则，默认不跟随符号链接；
- 输出路径相对 working directory，便于模型继续调用其他文件工具；
- `agent-tools` 不拥有 permission。即使 preset 将 `grep` 配成 `Allow`，文件 containment 仍是 executor 自身的能力边界。

### 输出

成功结果使用 `ToolContent::Text`：

```text
crates/agent-core/src/tools/registry.rs:47:    pub fn new(mut tools: Vec<Tool>) -> Result<Self> {
```

- 一条匹配行只输出一次，格式为 `path:line:text`；
- 文件遍历与输出顺序稳定；
- 无匹配是 `Succeeded("No matches found.")`，不是失败；
- `max_results` 或 32 KiB 文本预算任一触发即停止，并附一条明确的 truncated 标记；
- 二进制文件和非 UTF-8 字节不能 panic；首版跳过含 NUL 的文件，其他文本用有损 UTF-8 展示。

### 错误

| 场景 | 表达 |
|------|------|
| 非法 regex、target 不存在、target 越出 working directory | `Ok(ToolResult::failed(call, ..., false))` |
| 文件遍历或读取失败 | `Ok(ToolResult::failed(call, ..., false))` |
| blocking task join / runtime 故障 | `Err(anyhow::Error)` |

`grep` executor 不生成 `Denied`、`InvalidArguments` 或 `OutcomeUnknown`；这些状态仍归 `agent-core` 调用管线。

---

## 非目标

- 不在本 crate 创建或缓存 `ToolRegistry`；
- 不解析 preset，不实现 permission map；
- 不保存 trace/session/turn 身份；
- 不提供 scheduler resource claim；
- 不把 `bash`、`web_fetch` 与 `grep` 塞进一个通用 executor；
- 不用外部 `rg` 可执行文件作为首版运行时依赖；
- `web_fetch` 仍未实现；网络工具需要单独定义权限、超时和输出语义。

---

## 当前阶段

R1 已按确认后的 [`DESIGN.md`](DESIGN.md) 完成 crate scaffold、静态 catalog、`read` / `write` / `edit` / `find` / `grep` / `bash` spec/executor 与测试。公开接口未扩张；`web_fetch` 仍需单独完成设计确认后再实现。
