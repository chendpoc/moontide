# 工具驱动的信息探索与上下文效率

> **状态：讨论候选（未实现）**。本文记录关于大文件、多样数据源和有限上下文窗口的工具设计讨论；不改变当前 `agent-core`、`agent-tools` 或 `context` 契约。
>
> 当前契约：[`../agent-core.md`](../agent-core.md) · [`../../agent-core/src/tools/README.md`](../../agent-core/src/tools/README.md) · [`../../agent-core/src/context/README.md`](../../agent-core/src/context/README.md)

## 1. 问题

Agent 面对 HTML、TXT、JSON、日志、PDF、数据库或外部资源时，不能把完整内容直接放进模型上下文。需要在有限预算内取得足够、可定位、可继续探索的证据。

初步方向曾考虑统一的 `resource_inspect` / `resource_search` / `resource_read` 抽象。但 Pi 的实际工具经验显示，少量基础工具 `read`、`bash`、`grep`、`find`、`ls` 通过组合往往比大量高层语义工具更高效。原因可能包括：

- `bash` 具备管道和 Unix 工具组合能力，一次调用可以完成过滤、截断和转换；
- 基础工具的选择成本和 schema 复杂度更低；
- 路径、行号、stdout、stderr 是模型熟悉且稳定的输出形式；
- 原始内容没有被工具过早转换成错误的抽象。

Pi 的公开实现默认暴露 `read`、`bash`、`edit`、`write`，并可按需启用 `grep`、`find`、`ls`；其 system prompt 在这些探索工具存在时要求优先使用它们，否则使用 bash 进行文件探索。该事实支持“基础工具优先”的方向，但不能单独证明 Pi 与 Claude Code 的效果差异由工具集合造成；模型、system prompt、权限、turn 限制和上下文策略都是混杂变量。

## 2. 讨论结论

### 2.1 默认采用最小且可组合的工具基座

默认工具能力应保持为：

```text
read / grep / find / ls / bash
```

写入能力 `edit` / `write` 由 preset 和 permission map 控制。工具不应为了“泛化”变成一个参数复杂的万能 `read_anything`。

### 2.2 语义工具是加速器，不是替代物

HTML、PDF、日志、数据库等专用工具可以作为可选加速器：

```text
基础工具：read / grep / find / ls / bash
语义加速：html_outline / pdf_extract / log_query / json_query
索引检索：semantic_search / rerank / memory_recall
```

专用工具应该帮助模型更快找到证据，但模型仍然可以退回基础工具查看原始内容。专用工具不应建立一套让基础工具无法访问的封闭资源世界。

### 2.3 泛化对象是操作和证据，不是格式解析器

不同数据源可以共享以下语义：

```text
inspect → search/browse → read/extract → continue
```

但具体定位方式由工具决定：

| 数据源 | 典型定位方式 |
|---|---|
| TXT / 源码 | 行号范围、字节范围、grep 命中 |
| HTML | heading、DOM 节点、selector、链接 |
| PDF | 页码、章节、文本块、OCR 区域 |
| 日志 | 时间范围、turn、event、字段过滤 |
| JSON | JSON Pointer、路径、数组范围 |
| 数据库 | 表、查询、条件、分页游标 |
| Memory | memory ID、topic、来源记录 |

因此，未来可以在 `agent-tools` 内部复用资源 adapter 或证据 envelope；但第一阶段不把通用 `ResourceRef`、`Locator` 等类型提升到 `agent-core`，除非多个工具和消费者已经证明需要共享它们。

## 3. 大内容工具的共同要求

任何可能返回大量数据的工具都应支持至少一项有界机制：

- 范围读取；
- 分页或 continuation cursor；
- 结果数限制；
- 字节或 token 近似上限；
- 过滤；
- 截断标记；
- 稳定来源定位。

工具结果不能只返回一段没有边界的字符串。推荐的结果语义如下：

```json
{
  "content": "...",
  "complete": false,
  "locator": "lines:100-180",
  "next_cursor": "opaque-cursor",
  "provenance": "workspace/docs/example.txt"
}
```

`next_cursor` 对模型是 opaque value；工具负责验证 cursor 是否仍然对应同一资源版本。资源改变时，应返回明确的 stale 或 revision mismatch，而不是静默拼接不同版本的内容。

HTML 或 PDF 的摘要、outline、表格提取等结果必须明确标记为派生表示，并保留原始页码、节点或范围。不能让 `read` 在内部偷偷生成摘要并伪装成原文。

## 4. 所有权边界

```text
agent-tools
  ├── builtin catalog
  ├── text/file/bash executors
  ├── optional format adapters
  └── bounded evidence formatting
          │
          ▼
agent-core::tools
  ├── ToolSpec / ToolRegistry
  ├── input validation
  ├── ToolExecutor boundary
  └── ToolResult lifecycle
          │
          ▼
loop → TurnEvent → Session Item Log
          │
          ▼
context::materialize → model messages
```

`agent-core` 只负责：

- ToolCall / ToolResult 生命周期；
- 参数校验、权限、取消和错误；
- 调用结果身份配对；
- 模型可见工具结果的 Session 持久化路径；
- 必要的通用安全上限。

`agent-tools` 负责：

- 文件、HTML、PDF、日志、JSON 等具体解析；
- 搜索、分段、摘要、游标和来源定位；
- 选择返回原文、outline、records 或 table 等表示。

`context` 继续只负责已有 Session Item 到 provider-neutral `Message` 的 materialize，不加入格式特定读取逻辑。

## 5. 评测要求

不能仅凭工具数量判断设计好坏。至少需要同一模型、同一任务集的三组对照：

```text
A: read + bash + edit + write
B: read + grep + find + ls + edit + write
C: A/B + 语义加速工具
```

记录：

- 任务成功率；
- tool call 数量；
- turn 数量；
- 输入和输出 token；
- wall-clock 时间；
- 重复读取和无效调用；
- 证据覆盖率；
- 工具错误与恢复次数。

测试数据至少包含：大 TXT、长单行文本、HTML 噪声、JSON 深层结构、日志过滤、PDF 页范围和资源在探索期间发生变化的情况。

在评测证明基础工具不足之前，不引入向量数据库或复杂的统一资源检索层。优先验证：

```text
inspect → search/filter → bounded read → continuation
```

## 6. 非目标

- 不把 HTML/PDF/日志解析器放进 `agent-core`；
- 不用一个超级工具取代基础工具的组合能力；
- 不假设向量检索优于精确搜索；
- 不把派生摘要当成 Session Item Log 的事实源；
- 不因为本讨论直接修改当前 `context::materialize` 返回值；
- 不在没有实际消费者前新增 scheduler、通用 Resource trait 或第二套 registry。

## 7. 参考实践

- [Pi coding-agent system prompt](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/system-prompt.ts)：基础工具默认集合及 grep/find/ls 的按需启用。
- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)：工具可组合性、分页、范围、过滤、截断和工具输出的 token 效率。
- [Anthropic: Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)：just-in-time context 与 progressive disclosure。
- [MCP Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)：URI、resource templates、分页读取和资源链接。
- [OpenAI Vector Stores](https://platform.openai.com/docs/api-reference/vector-stores)：分块、metadata filter、rerank、分页和来源片段。
- [OpenViking architecture](https://github.com/volcengine/OpenViking/blob/main/docs/en/concepts/01-architecture.md)：L0/L1/L2、统一 URI 和分层加载，作为候选参考而非 MoonTide 当前承诺。
