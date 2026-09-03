# agent-tools

> **性质：** 第一方工具库的对外使用说明。
> **状态：** R1 已实现；静态 catalog 当前包含 `read`、`write`、`edit`、`find`、`grep`、`bash`、`web_search`。
> **运行时契约：** [`../agent-core/src/tools/README.md`](../agent-core/src/tools/README.md)。
> **实现细节：** [`DESIGN.md`](DESIGN.md)

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

### `web_search`

`web_search` 聚合不需要 provider API key 的网页搜索渠道，是第一个网络 builtin：

```json
{
  "query": "rust async trait",
  "max_results": 5
}
```

| 字段 | 必填 | 语义 |
|------|------|------|
| `query` | 是 | 发送给搜索提供方的查询词；不能为空 |
| `max_results` | 否 | 最大结果数，默认 5，范围 1–20 |

### 网络边界

- DuckDuckGo 使用固定的 HTML 搜索 endpoint；SearXNG 只使用宿主配置的 `MOONTIDE_SEARXNG_BASE_URL`，未配置时不启用；
- endpoint 不进入 tool schema，模型只能控制 `query` 与 `max_results`，不暴露任意 URL 抓取，因此本工具没有由模型输入产生的 SSRF 面；
- 两个 provider 以 best-effort aggregate 方式调用；单个 provider 失败不阻断其他 provider，部分成功仍返回成功结果；
- HTTP client 在 `build()` 中以 30s 总超时构造，请求走 async，不占 `spawn_blocking` 线程；
- provider 的传输错误、5xx、408、429 与 timeout 保留 `retryable=true`；配置、4xx 和畸形响应体为 `retryable=false`；
- `web_search` 不读取 API key，也不保存搜索缓存；`web_fetch` 仍是独立后续能力。

### 输出

成功结果使用 `ToolContent::Text`，格式为编号列表：

```text
1. Title
Provider: duckduckgo
URL: https://example.com/1
content snippet...
```

- 每条结果保留 provider attribution；相同 URL 只保留一次；
- 至少一个 provider 成功但没有结果时返回 `Succeeded("No results found.")`，不是失败；
- 仅部分 provider 成功时返回结果，并附带简短 provider warning；
- 结果连同截断标记不超过 32 KiB 文本预算。

### 错误

| 场景 | 表达 |
|------|------|
| 所有 provider 传输错误 / 5xx / 408 / 429 / timeout | `ToolResult::failed(call, ..., retryable=true)` |
| 所有 provider 配置错误、其他 4xx、畸形响应体 | `ToolResult::failed(call, ..., retryable=false)` |
| typed input 与 schema 漂移 | `Err(anyhow::Error)` |

`web_search` executor 不生成 `Denied`、`InvalidArguments` 或 `OutcomeUnknown`；这些状态仍归 `agent-core` 调用管线。permission（Allow/Ask）由 `agent` 组合根声明，本 crate 不默认授权。

---

## 非目标

- 不在本 crate 创建或缓存 `ToolRegistry`；
- 不解析 preset，不实现 permission map；
- 不保存 session/turn 身份或观测分区键；
- 不提供 scheduler resource claim；
- 不把 `bash`、`web_fetch` 与 `grep` 塞进一个通用 executor；
- 不用外部 `rg` 可执行文件作为首版运行时依赖；
- 不接入 Tavily、Brave、Gemini Web 或其他需要 API key / 浏览器登录态的渠道；
- 不硬编码公共 SearXNG 实例，不实现 provider 健康探测、缓存、自动 retry 或动态配置 reload；
- `web_fetch`（任意 URL 抓取）仍未实现；它与 `web_search` 的 SSRF 面、超时和输出语义不同，需单独设计确认后再实现。

---

## 当前阶段

R1 与 `web_search` R1.2 已按确认后的 [`DESIGN.md`](DESIGN.md) 完成 crate scaffold、静态 catalog、`read` / `write` / `edit` / `find` / `grep` / `bash` / `web_search` spec/executor 与测试。`web_fetch`（任意 URL 抓取）仍需单独完成设计确认后再实现。
