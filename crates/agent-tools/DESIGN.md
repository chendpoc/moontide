# agent-tools — 技术设计

> **读者：** 实现者、代码审查。
> **状态：** R1 已实现并完成 Review。
> **对外契约：** [`README.md`](README.md)。
> **上游边界：** [`../agent-core/src/tools/DESIGN.md`](../agent-core/src/tools/DESIGN.md)。

---

## 1. 目标与边界

### 1.1 目标

1. 用编译期静态 catalog 声明 MoonTide 第一方工具；
2. 用最小 `ToolDefinition` 表达“名称 + build 配方”；
3. 每次 build 返回 `agent_core::tools::Tool`，复用唯一 runtime contract；
4. 每个 builtin 保持 spec 与 executor 物理分离；
5. 首批用 `grep` 验证 catalog、文件边界、blocking IO 与有界结果。

### 1.2 不做

| 不做 | owner |
|------|-------|
| frozen runtime registry | `agent-core::tools::ToolRegistry` |
| preset name 选择、未知 name 报错 | `agent` bootstrap |
| `Allow` / `Ask` 声明 | `agent` preset |
| 调用顺序、input validation、permission check | `agent-core::loop` |
| 多调用并发、取消、resource claim | `scheduler` |
| MCP / sidecar 动态发现 | 后置 runtime / adapter |
| 外部 manifest 与热加载 | 后置，出现真实消费者后再评审 |

---

## 2. crate 与模块结构

```text
crates/agent-tools/
  Cargo.toml
  README.md
  DESIGN.md
  TASKS.md
  src/
    lib.rs
    catalog.rs
    grep/
      mod.rs
      spec.rs
      executor.rs
    tests.rs
```

可见性：

- `lib.rs` 只 re-export `ToolDefinition` 与 `builtin_tool_definitions`；
- `catalog`、`grep` 及其内部类型不公开；
- `ToolDefinition` 字段私有，crate 内使用 `const fn new` 建表；
- executor 类型不跨 crate 暴露，运行时只看到 `Arc<dyn ToolExecutor>`。

依赖：

```text
agent-tools
  ├── agent-core     # Tool / ToolSpec / ToolCall / ToolExecutor / ToolResult
  ├── anyhow
  ├── ignore         # respect ignore files, stable recursive walk, no symlink following
  ├── regex
  ├── serde / serde_json
  └── tokio          # spawn_blocking
```

`ignore` 使用 0.4 系列，`regex` 复用 workspace 1.x。首批不引入 `grep-searcher` 或外部 `rg` 进程：当前只需要“一行是否匹配”，`ignore + regex` 足够，且能由本 crate直接控制 path containment 与输出预算。

---

## 3. `ToolDefinition` 与 catalog

### 3.1 类型

```rust
type ToolBuilder = fn() -> anyhow::Result<agent_core::tools::Tool>;

pub struct ToolDefinition {
    name: &'static str,
    builder: ToolBuilder,
}

impl ToolDefinition {
    pub(crate) const fn new(name: &'static str, builder: ToolBuilder) -> Self;
    pub fn name(&self) -> &'static str;
    pub fn build(&self) -> anyhow::Result<agent_core::tools::Tool>;
}
```

`build()` 的算法：

```text
tool = builder()?
if tool.spec().name() != definition.name:
    error("tool definition name mismatch")
return tool
```

这个检查避免 catalog 按 `grep` 被选择，实际却把另一个 name 放进 registry。错误发生在组合根启动阶段，不延迟到 prompt/dispatch 漂移后。

### 3.2 静态表

```rust
static BUILTIN_TOOL_DEFINITIONS: &[ToolDefinition] = &[
    ToolDefinition::new("grep", grep::build),
];

pub fn builtin_tool_definitions() -> &'static [ToolDefinition] {
    BUILTIN_TOOL_DEFINITIONS
}
```

不变量：

1. name 符合 `ToolSpec` 的 portable name 约束；
2. name 唯一且按字典序稳定排列；
3. definition name 与 built `ToolSpec.name` 一致；
4. build 无真实 IO 副作用；
5. catalog 不持有已构造的 `Tool`，不同 agent bootstrap 可各自 build 独立 executor；
6. catalog 不提供 runtime mutation API。

首版 catalog 很小，调用者线性查找即可；不增加 map、resolver 类型或第二套 registry。catalog 规模或动态来源真正出现后再评审索引。

### 3.3 为什么 builder 是零参数函数

当前 builtin 的静态依赖可以在 build 内构造，运行时 `working_dir` 已由 `ToolExecutor::execute` 显式接收。首版不为未来 token、client、sandbox 或 sidecar 预设通用 context；这种 context 会把不同工具的依赖重新耦合成 service locator。

未来某个工具确实需要配置时，先判断配置是否属于：

- preset 选择：留在 `agent`；
- 每次调用输入：放 schema；
- executor 自身固定依赖：由该工具的私有 builder 构造；
- 跨工具真实共享资源：再评审一个具体、窄的工厂边界。

---

## 4. builtin 的 spec / impl 分离

`grep` 的绑定点只有 `grep/mod.rs`：

```text
grep::build()
  → spec::build()            # pure ToolSpec
  → Arc::new(GrepExecutor)   # IO implementation
  → Tool::new(spec, executor)
```

硬约束：

- `spec.rs` 不 import `std::fs`、`tokio` 或 `ignore`；
- `executor.rs` 不创建 JSON Schema；
- `executor.rs` 不查询 permission，不写 Session/RunEvent；
- `mod.rs` 只组合，不复制执行逻辑；
- 公共 runtime 状态全部使用 `agent-core::tools` 类型，不定义平行 outcome/registry。

---

## 5. `grep` 设计

### 5.1 schema 与 typed input

`spec.rs` 声明 Draft 2020-12 object schema：

```text
pattern: string, minLength=1, required
path: string, minLength=1, optional, default="."
max_results: integer, minimum=1, maximum=1000, optional, default=100
additionalProperties=false
```

`executor.rs` 使用私有 `GrepInput` 反序列化同一形状，并用 serde default 实际应用默认值。schema default 只作模型提示，不承担运行时填充。schema 与 typed input 的一致性由测试守门；反序列化仍失败表示实现漂移，返回 `anyhow::Error`，不能伪装成用户 regex 错误。

首版 pattern 使用 Rust `regex::Regex`：搜索单位是一行，只判断该行是否至少命中一次。非法表达式是可预期工具失败，`retryable=false`。

### 5.2 路径解析

```text
canonical_working_dir = canonicalize(working_dir)
requested = absolute(path) ? path : canonical_working_dir.join(path)
canonical_target = canonicalize(requested)
require canonical_target.starts_with(canonical_working_dir)
```

语义：

- working directory 无法 canonicalize 是宿主配置/基础设施错误，走 `Err`；
- target 不存在或越界是模型可修正的工具失败，走 `ToolResult::failed`；
- target 可以是单个文件或目录；其他文件类型返回失败；
- 目录用 `ignore::WalkBuilder`，保留 standard filters，显式绑定调用传入的 `working_dir`、允许非 Git 仓库中的 `.gitignore`、设置 `follow_links(false)`，并按路径排序；
- walker 只处理 regular files；symlink、directory 和特殊文件不读；
- 不修改进程 cwd。

`starts_with` 比字符串前缀可靠，因为比较的是 canonical path component。canonicalize 也使“工作区内 symlink 指向外部”的 target 在 containment 检查中被拒绝；walker 不跟随后续 symlink。

### 5.3 blocking IO

文件遍历和读取是 blocking 工作，不能直接占用 async runtime worker：

```text
execute(&ToolCall, &Path)
  → clone 已验证 input + PathBuf
  → tokio::task::spawn_blocking(move || search(...))
  → join error: anyhow::Error
  → search result: ToolResult
```

R1 没有 cancellation token；`spawn_blocking` 开始后不能可靠取消。scheduler 的取消/预算模型确认前，不在 executor 私造全局线程池或取消 flag。搜索自身依靠 match/output 上限提前停止。

### 5.4 文本读取与匹配

每个文件先用固定大小 buffer 扫描是否含 NUL；含 NUL 时整文件跳过，避免输出 NUL 之前的部分匹配。文本文件 rewind 后再用 `BufReader::read_until(b'\n', &mut Vec<u8>)`：

1. 维护 1-based line number；
2. bytes 用 `String::from_utf8_lossy` 转成模型可见文本；
3. 去掉 CR/LF 后调用 `Regex::is_match`；
4. 每个匹配行输出一次，不按同一行的 match 数重复；
5. 路径相对 canonical working directory 并统一为 `/` 分隔符。

首版读取错误 fail-fast 为 `Failed { retryable: false }`，不混合“部分结果 + 隐藏错误”。需要 best-effort diagnostics 时，先定义结构化消费者再扩展。

### 5.5 结果预算

常量：

```text
DEFAULT_MAX_RESULTS = 100
MAX_MAX_RESULTS = 1000
MAX_OUTPUT_BYTES = 32 * 1024
```

停止条件：

- 已输出 `max_results` 条；或
- 下一条加入后会超过 32 KiB UTF-8 文本预算。

触发时追加稳定标记，例如 `[truncated: result limit reached]` 或 `[truncated: output limit reached]`。标记本身必须计入 32 KiB；单行过长时只保留能安全落入预算的 UTF-8 前缀。没有匹配时返回固定文本 `No matches found.`。

这两个简单上限防止 builtin 把无界仓库内容注入下一次 LLM request；artifact spill 仍属于后置设计。

### 5.6 错误映射

| 来源 | 返回 |
|------|------|
| schema 已通过但 typed input 反序列化失败 | `Err(anyhow::Error)`，表示 spec/impl 漂移 |
| regex 编译失败 | `Ok(ToolResult::failed(call, ..., false))` |
| target 不存在、越界、类型不支持 | `Ok(ToolResult::failed(call, ..., false))` |
| walker/read IO error | `Ok(ToolResult::failed(call, ..., false))` |
| `spawn_blocking` JoinError | `Err(anyhow::Error)` |
| 找到/未找到匹配 | `Ok(ToolResult::succeeded(call, Text))` |

executor 不返回 `OutcomeUnknown`：`grep` 是只读操作，不存在“写入是否发生未知”。

---

## 6. 测试设计

每个测试前按 `AGENTS.md` 写清场景、预期和不变量/副作用。

### Catalog

- definitions 按 name 稳定排序且唯一；
- 每个 definition build 成功且 spec name 相同；
- 人工构造 mismatch definition 时 build 失败；
- build 不执行 grep 文件 IO。

### Grep spec

- built Tool 可被 `ToolRegistry::new` 接受；
- schema 字段、required/default/range 与 typed input 保持一致；
- spec 只暴露 portable name `grep`。

### Grep executor

- 默认 path 搜索 working directory，输出相对路径与行号；
- 目录递归且遵守 `.gitignore`；
- 单文件 target 可搜索；
- invalid regex、缺失 target、越界 target 返回 non-retryable failure；
- binary 文件跳过且不 panic；
- 非 UTF-8 文本有损显示且不 panic；
- `max_results` 与 32 KiB 预算都能产生明确 truncated 标记；
- 无匹配返回成功；
- 测试只使用 `tempfile`，不读取真实仓库或依赖外部 `rg`。

---

## 7. 实现分期

| 批 | 范围 |
|----|------|
| **R1** | crate scaffold、`ToolDefinition`、静态 catalog、`grep` spec/executor、结构与行为测试 |
| 后续 | `bash` 设计确认后单独一批；`web_fetch` 设计确认后单独一批 |

R1 不同时实现 `bash` / `web_fetch`。这些工具的权限、进程/网络错误和输出语义不同，强行共用首批抽象会降低内聚。

---

## 8. 决策记录

1. `agent-core::tools` 保留 runtime contract，builtins 独立为 `agent-tools` crate；
2. 依赖只能是 `agent-tools → agent-core`；
3. catalog 是编译期静态 slice，不是第二套 registry；
4. `ToolDefinition` 只含静态 name 与零参数 builder；
5. definition build 时验证 name 与 built spec 一致；
6. 每个 builtin 继续 spec / executor 物理分离；
7. permission 归 `agent` preset，catalog 不声明默认授权；
8. 首个 tracer bullet 是内建 Rust `grep`，不依赖外部 `rg`；
9. `grep` target 被限制在 canonical working directory 内，目录遍历不跟随 symlink；
10. `grep` 使用 `ignore` + `regex`，blocking IO 经 `spawn_blocking`；
11. `grep` 输出受 max results 与 32 KiB 双上限约束；
12. 不为未来 builtin 预设 ToolLibrary、manifest、build context、宏注册或公共 executor 基类。
