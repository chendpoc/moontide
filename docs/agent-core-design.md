
LLM agent 运行时的架构设计文档：如何把一条 prompt 推进为一次完整对话执行、对外暴露给观察者、让 developer 以专业方式内置系统能力，而最终用户只面对窄而专业的配置面。

本文档自包含，不依赖任何特定实现、包或代码库。示例用 TypeScript 表达以求精确；设计本身与语言无关。

**MoonTide 落盘：** 开发计划 [`notes/agent-core-roadmap.md`](notes/agent-core-roadmap.md) · 术语 [`AGENTS.md`](../AGENTS.md) §7.2（**RunEvent bus** · **resolveRunConfig** · **resolveTurnContext**；不用 sink / fold）。

---

## 1. 设计哲学

本文档与"平台中立、一切交给用户组合"的极简方案的根本分歧在这里：

1. **专业设计必须内置，不能外包给用户。** 安全、信任、权限、上下文管理、模型路由——这些需要专业判断的系统能力，由 developer / project owner 设计、内置、默认启用。把它们做成"用户可选的插件"不是自由，是推卸责任。
2. **默认正确（safe by default, opinionated by design）。** 不配置时，agent 的行为是保守而专业的；用户配置是"调节旋钮"，不是"编写行为"。
3. **配置面窄而专业，扩展面留给 developer。** 最终用户面对的参数是产品团队决策过的；钩子与插件只向 developer 开放。
4. **极简引擎 + 有主见产品层。** 引擎保持小（时序、写入、事件），但产品层（Preset）是内置的、经过评审的、默认锁定的装配——不是给用户拼装的示例。

---

## 2. 目标

1. **时序唯一权威**。核心是唯一决定"下一个时刻是什么"的地方。扩展可以观察阶段、贡献决策，但永远不能定义步骤或改变顺序。
2. **生命周期配对是结构性的，不是靠记忆**。run 开始/结束、turn 开始/结束通过组合配对。任何地方都不手写事件；"忘了发结束事件"在结构上不可能。
3. **会话记录写入受控**。所有消息写入都经过一个入口。消息事件在同一处派生。记录与事件不可能不一致。
4. **内置系统能力**。每个决策点都有生产级默认实现；默认行为是保守的、专业设计的、可审计的。
5. **窄界面**。插件只收到被调用的那个钩子的参数。不存在可以"够到"任何东西的 context 对象。能力靠类型隐藏，不靠约定约束。
6. **协议只增不改**。事件类型与钩子签名只能加成员，不能改或删成员。破坏性变更走新协议版本。

## 3. 非目标

1. **不设计嵌套 agent 内核**。多 agent 编排是组合层的事。核心永远不需要知道"子 agent"存在。
2. **不做运行时钩子注册**。没有注册表，没有热插拔。插件数组在 run 开始前装配并冻结。
3. **不用 reducer/状态机执行**。循环是顺序过程：一个时序权威、显式组合子、并行只经由注入的 effects。
4. **插件不能定义阶段**。插件挂载到阶段上；它们不创造阶段。
5. **渲染协议永不进入语义协议**。流式 delta 永远停留在渲染流上。
6. **不把系统能力做成可选插件**。安全、信任、上下文管理默认内置；"不装插件就没有安全"的产品形态不存在。

---

## 4. 术语表

| 术语 | 含义 |
|---|---|
| **Run** | 从一条 prompt（或续接）到最终结果的一次执行。短生命周期，自包含。 |
| **Turn** | 一次 LLM 请求加上它触发的工具执行。一个 run 包含一个或多个 turn。 |
| **Transcript** | run 迄今产生的有序消息列表。run 内只追加。 |
| **Event** | 核心发出的值，供订阅者与插件观察。 |
| **语义协议** | 消息/工具粒度的完整事件：开始、结束、结果。稳定，面向持久化与策略。 |
| **渲染协议** | delta 粒度的事件：部分文本、思考、工具调用流。面向 UI。 |
| **Hook** | developer 提供给核心、由核心在固定点调用的函数。钩子返回决策。 |
| **Effect** | 注入的能力边界：provider 流、工具执行、定时器。I/O 唯一发生的地方。 |
| **Snapshot** | 给观察者的不可变上下文视图；绝不是可变句柄。 |
| **Preset** | developer 内置的装配单元：工具集 + 策略 + 默认值 + 安全边界的组装，评审过、默认锁定。 |
| **配置面** | 最终用户能接触的参数集合。窄、专业、只调节不重写。 |
| **扩展面** | developer 能接触的钩子与插件接口。深度定制的合法位置。 |

---

## 5. 架构总览

```text
最终用户层
  配置面：preset + 参数调节                    ← 窄而专业；不暴露钩子
        ↓
产品层（Preset）                              ← developer 的杰作
  内置工具集 / 默认策略 / 安全边界 / 默认锁定
        ↓
平台层（扩展面）                              ← 只对 developer
  hooks: first / waterfall / blockable        ← 只返回决策
  plugins: on 阶段观察
        ↓
核心（最小时序引擎）
  组合子（run / turn）                        ← 唯一时序权威；配对结构保证
  受控日志（append）                          ← 唯一写入路径；事件在此派生
  钩子折叠器（启动时折叠一次）                ← 唯一分派点
        ↓
事件流（渲染协议，异步生成器）
        ↓
订阅者：UI / CLI / RPC / 持久化 / 遥测
```

**分层原则**：能力越接近安全与正确性，越往内放、越默认锁定；能力越接近表现与策略调节，越往外放、越参数化。核心刻意做得小；产品层刻意做得有主见。

---

## 6. 状态模型：一个写入者，一份日志

Transcript 是 run 唯一的可变状态。它只有一条写入路径，而这条路径同时产生对应事件：

```ts
interface MessageLog {
  /** 类型上只读。 */
  readonly messages: readonly AgentMessage[];
  /** 唯一变更路径。返回该消息对应的事件。 */
  append(msg: AgentMessage): MessageEvent[];
}

function createMessageLog(): MessageLog {
  const messages: AgentMessage[] = [];
  return {
    get messages() { return messages as readonly AgentMessage[]; },
    append(msg: AgentMessage) {
      messages.push(msg);                        // 零复制
      return [
        { type: "message_start", message: msg },
        { type: "message_end", message: msg },
      ];
    },
  };
}
```

规则：

- 记录类型上只读；`append` 是唯一变更路径。
- 每次 `append` 产出它的事件。没有其他代码会发出 message-start/message-end。
- 流式 delta 永不触碰日志：它们是渲染协议，与日志并排走事件流。

**决策**。拒绝了纯不可变（每次 turn 复制）：对于不断增长的 transcript 是每轮 O(n)，而 `append` 已经集中了变更，纯不可变没有结构性收益。日志是"受控变更 + 事件投影"，不是"不可变值"。

**不变式**。记录与事件不可能分叉：它们是同一条语句的两个投影。

---

## 7. 时序引擎

核心序列由泛型组合子描述。组合子的函数体是生命周期事件唯一产生的地方。

```ts
async function* withTurn<T extends TurnOutcome>(
  inner: AsyncGenerator<AgentEvent, T>,
): AsyncGenerator<AgentEvent, T> {
  yield { type: "turn_start" };
  const outcome = yield* inner;
  yield { type: "turn_end", message: outcome.assistantMessage, toolResults: outcome.toolResults };
  return outcome;
}

async function* withRun<T>(
  log: MessageLog,
  inner: AsyncGenerator<AgentEvent, T>,
): AsyncGenerator<AgentEvent, T> {
  yield { type: "run_start" };
  try {
    return yield* inner;
  } finally {
    yield { type: "run_end", outcome: finalize(log.messages) };   // 唯一出口，唯一结束
  }
}
```

性质：

- `finally` 保证错误路径也发 run-end；生成器是 run 的唯一出口帧。
- 业务代码不含任何阶段标记。它消费排队消息、provider 流、工具结果；写入走日志与 effect 边界。
- `yield` 是唯一的发射方式。循环里没有 sink 对象被传来传去。

### 顺序不变式（核心契约）

| 不变式 | 保证方式 |
|---|---|
| 恰好一个 `run_start`，先于一切其他事件 | 组合结构 |
| 恰好一个 `run_end`，是 run 的最后一个事件 | 唯一出口帧（`finally`） |
| turn 在 run 内严格嵌套 | 组合子只在 run 循环内包裹 |
| 每个 message-start 有配对的 message-end；中间没有东西进日志 | `append` 原子地发出这一对 |
| tool-execution-start/end 总是配对 | 工具执行器内发出，单帧 |

---

## 8. 事件协议

```ts
type AgentEvent =
  | { type: "run_start" }
  | { type: "run_end"; outcome: Outcome }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AssistantMessage; toolResults: readonly ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; delta: StreamDelta }   // 渲染协议
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean };
```

同一流上有两类事件并存：

- **语义事件**（`run_start`、`turn_*`、`message_start/end`、`tool_execution_*`）：稳定、完整，面向持久化、策略与观察。
- **渲染事件**（带 delta 的 `message_update`）：高频、不完整，只面向 UI。协议一次性声明：渲染事件永不进入语义观察钩子。

忽略未知字段的消费者不受影响；新行为读取新字段。**协议只增不改。**

---

## 9. 错误模型

一个 run 恰好以三种结果之一结束：

```ts
type Outcome =
  | { kind: "success"; messages: readonly AgentMessage[] }
  | { kind: "aborted"; messages: readonly AgentMessage[] }
  | { kind: "error"; messages: readonly AgentMessage[]; error: ErrorInfo };

interface ErrorInfo {
  code: "user_abort" | "provider_error" | "tool_error" | "context_exhausted";
  message: string;
  retryable: boolean;
}
```

**Turn 原子性**。turn 是恢复边界：它要么完整结束，要么结束在一个"续接合法"的状态（结果里带着该状态）。重试是产品层策略；可恢复性来自核心的 turn 原子性契约。

**错误分类**。四种 code 对应不同的恢复语义：`user_abort` 永不重试；`context_exhausted` 提示先压缩上下文再重试；`tool_error` 可能由模型自己恢复；`provider_error` 且 `retryable: true` 时允许产品层退避重试。

**错误处理的默认设计（产品层职责）**。默认装配必须包含：退避重试、上下文压缩触发、错误向用户的专业呈现。这些不需要最终用户配置；它们是 Preset 的一部分。

---

## 10. 钩子契约

钩子是扩展面（developer）保留的唯一控制通道。窄参数、语义类型化：

```ts
type FirstHook<T>      = (ctx: HookContext<T>) => Promise<T | undefined>;  // 第一个非 undefined 生效
type WaterfallHook<T>  = (input: T, ctx: HookContext<T>) => Promise<T>;    // 链式传值
type BlockableHook<P>  = (params: P, ctx: HookContext<P>) => Promise<{ block?: boolean; reason?: string }>;
type DecisionHook<T>   = (ctx: HookContext) => Promise<T>;                 // 咨询性决策

interface Hooks {
  resolveModel?:        FirstHook<Model>;
  getApiKey?:           FirstHook<string | undefined>;
  transformContext?:    WaterfallHook<readonly AgentMessage[]>;
  beforeToolCall?:      BlockableHook<ToolCallContext>;
  afterToolCall?:       MutableHook<ToolResult>;
  shouldStopAfterTurn?: DecisionHook<boolean>;
}
```

规则：

- **没有 context 容器**。扩展只按签名收到该次钩子调用需要的东西。能力的不存在写在类型里，所以是"构造上不可能"，而不是"运行时约定禁止"。
- **只返回决策**。控制钩子返回数据。钩子签名里没有任何东西能改状态、写 transcript、或发起 provider 请求。采纳与否由核心决定。
- **生产级默认**。每个钩子在默认装配中都有内置实现；developer 覆盖是"调整专业设计"，而不是"从零编写"。最终用户看不到这一层。
- **语义在签名里**。`FirstHook`、`WaterfallHook`、`BlockableHook` 的顺序与短路语义写在类型里。
- **组合子取代注册表**。`first()` 与 `waterfall()` 是对钩子数组的普通高阶函数，启动时构造一次：

```ts
function first<T>(hooks: ReadonlyArray<FirstHook<T>>): FirstHook<T> {
  return async (ctx) => {
    for (const hook of hooks) {
      const result = await hook(ctx);
      if (result !== undefined) return result;
    }
    return undefined;
  };
}

function waterfall<T>(hooks: ReadonlyArray<WaterfallHook<T>>): WaterfallHook<T> {
  return (input, ctx) => hooks.reduce(
    (chain, hook) => chain.then((value) => hook(value, ctx)),
    Promise.resolve(input),
  );
}
```

---

## 11. 插件契约（平台层，只对 developer）

```ts
interface Plugin {
  name: string;
  on?: {
    runStart?:  (ctx: RunContext) => void | Promise<void>;
    runEnd?:    (ctx: RunContext, outcome: Outcome) => void | Promise<void>;
    turnStart?: (ctx: TurnContext) => void | Promise<void>;
    turnEnd?:   (ctx: TurnContext) => void | Promise<void>;
    message?:   (msg: AgentMessage) => void | Promise<void>;     // 仅 append 边界
    tool?:      (event: ToolEvent) => void | Promise<void>;
  };
  hooks?: Hooks;   // 控制通道，见 §10
}
```

规则：

- **`on` 阶段是观察**。它们看到语义边界（消息开始/结束），永不见渲染 delta。它们拿到快照，绝不是可变句柄。
- **`hooks` 是决策通道**。同一个插件可以同时持有两者，但每个能力按类型分开；观察回调什么都不能改。
- **插件数组在 run 前冻结**。没有运行时注册，没有热替换。
- **插件由 developer 编写，不面向最终用户**。最终用户配置面上不出现 plugin 概念；他们选择 Preset，而不是挑选插件。

---

## 12. Preset 层（产品层，本文档的落点）

Preset 是 developer 替用户做的专业设计的载体。

```ts
interface Preset {
  name: string;                      // "coding" | "chat" | "research" | ...
  version: string;
  tools: ToolSet;                    // 内置工具集：挑选、护栏、参数默认
  hooks: Partial<Hooks>;             // 覆盖或扩展默认策略
  defaults: {
    model: ModelSelector;            // 默认模型与路由
    thinking: ThinkingLevel;
    retry: RetryPolicy;
    contextWindow: ContextPolicy;    // 压缩阈值、压缩策略
    trust: TrustPolicy;              // 默认保守、默认启用
  };
  safety: SafetyBoundary;            // 权限边界；最终用户不能解除，只能放宽（显式）
  exposes: ConfigSchema;             // 配置面：最终用户能调什么，类型化
}

function createAgent(config: { preset: string; model?: string; /** 仅 config.exposes 内的键 */ }) {}
```

### 12.1 配置面 vs 扩展面（最重要的一条线）

| | 配置面（最终用户） | 扩展面（developer） |
|---|---|---|
| 形态 | `createAgent({ preset, model, ...exposes })` | hooks、plugins、自定义 Preset |
| 位置 | 产品层之上 | 平台层 |
| 能做什么 | 调节参数：模型、语气、阈值 | 定义行为：策略、工具、安全 |
| 不能做什么 | 触碰时序、事件、安全边界 | 触碰时序、发射事件（与配置面相同） |

**规则**：配置面的一切键都来自 `Preset.exposes`（类型化的 ConfigSchema）。用户请求的键不在 schema 内，编译期即失败。这保证"用户自由度"永远在产品团队决策过的范围内。

### 12.2 默认锁定（safe by default）

- 安全、信任、权限、数据边界：**默认启用、默认保守**。Preset 的安全边界是产品声明；最终用户不能删除，只能按 schema 显式放宽，且放宽在界面上标注风险。
- 覆盖默认策略时，行为是"在默认之上调节"（如 `retry.maxAttempts: 3`），不是"重写默认"（如"提供你自己的重试实现"）。重写属于扩展面，最终用户不可达。

### 12.3 回迁纪律（产品原则）

某个能力如果被多个 Preset 常规性地需要，以至于每个 Preset 都必须自带某个插件，它就必须被提升进核心或平台层的内置默认，而不是停留在"共享插件"里。**专业设计必须内置，不能外包**——这条在这里从"维护规则"升级为产品原则：系统性行为属于平台，不属于用户选择。

### 12.4 Preset 的组合

- Preset 可继承：`research extends coding`（继承工具集与策略，覆盖配置面）。
- Preset 之间的组合是产品团队的评审动作，不是用户的运行时动作；用户只能选择已发布的 Preset。
- 每个 Preset 有 version；协议只增不改的规则同样约束 Preset 的 exposes schema。

---

## 13. 组合

- run 自包含：它持有自己的上下文快照、自己的 abort 信号、自己的事件流。任何宿主都能持有任何 run。
- 多 agent 编排在核心之外组合：子 agent 要么是工具执行的一个完整 run，要么是消费另一个 run 事件的桥。核心永远不知道。
- **组合契约测试**：两个 run 并发执行，彼此的 steering、abort、事件互不可见。该测试属于稳定契约套件。

---

## 14. 稳定性机制

| 机制 | 防止什么 | 在哪执行 |
|---|---|---|
| **契约测试** | 事件协议顺序漂移（黄金序列：成功、中止、截断、工具错误、steering、follow-up、多轮） | 测试套件 |
| **协议只增不改** | 事件或钩子签名的静默破坏性变更（Preset 的 exposes schema 同规则） | 代码评审 + 形状比对测试 |
| **能力白名单** | 扩展绕过类型系统（如 `as any` 逃生） | 三层：类型签名里没有该能力 → 运行时没有通道（钩子只返回决策）→ 行为测试断言插件不能发射事件 |
| **默认正确测试** | "不配置即不安全"的产品缺陷 | 测试套件：每个 Preset 的默认装配必须通过安全与行为基线 |
| **核心变更门（RFC）** | 阶段/拓扑变更借扩展之手渐进渗入，侵蚀不变式 | 评审流程 |

---

## 15. 设计决策

**借鉴：双层生命周期（Compiler/Compilation 模式）。** 会话级对象（长生命周期）生成 run 级对象（短生命周期）。run 对象持有快照、abort、事件；会话对象持有配置与排队消息。这一分离让错误模型与组合契约成为可表达的东西。

**拒绝：带完整 context 的插件容器（Vite/Rollup 风格）。** 一个带方法的容器对象在 TypeScript 里等于把核心的全部能力交给了扩展，而且随核心演进无界膨胀。"窄钩子按签名"方案把容器类从接口里整个删掉了。推论：扩展不能发射事件、不能跳过阶段、不能触碰状态。

**拒绝：动态钩子注册表（Tapable 风格）。** 注册表解决热注册问题；一个在 run 前装配好的冻结插件数组没有这个问题。`first`/`waterfall` 作为普通函数更简单、类型更完整。

**拒绝：reducer/状态机执行。** run 是每一步都带 I/O 的顺序过程（流式、工具、中止、运行中 steering）。纯 reducer 表达不了流式部分状态；转移表则让人多推理一层机器。

**接受：async generator 作为时序载体。** `yield` 是唯一的发射；`return`/`finally` 是唯一出口帧。生命周期配对从"记得做的簿记"变成语言结构。

**拒绝：平台中立、一切交给用户组合（极简方案）。** 极简引擎本身是合理的（本文档保留），但"所有系统能力都做成可选注入、用户是总装配工"的产品形态被否定。专业设计必须内置、默认启用、默认保守；用户面对的是决策过的接口，不是零件清单。

---

## 16. 扩展点与未来工作

1. **恢复语义**。重试/续接语义可借 `Outcome.retryable` 与 turn 原子性自然导出，但 turn 之间的完全自由重入需要一个显式的状态损失模型。实现前先立 RFC。
2. **多 agent**。今天只有组合契约。真做时，宿主级"lane"模型（一个会话、多个并发 run）是自然归宿。
3. **Preset 生态**。平台层开放后，第三方 developer 可以发布 Preset；发布需要满足默认正确基线与 schema 评审。
4. **消息模型增长**。思考 delta 已存在；新的 provider 能力（路由、拒绝）会扩展消息类型——只走增量式声明合并，留在语义协议内。

---

## 17. 稳定的定义

稳定不等于冻结。它意味着：

- 顺序不变式被契约测试钉死；
- 类型表面（钩子 + 事件 + Preset schema）只增成员；
- 扩展除了自己的钩子参数和自己返回的决策，没有任何通道；
- 默认装配始终通过安全与行为基线（"不配置即不安全"被测试排除）；
- 任何核心变更都以"命名、刻意、过评审门"的步骤出现，而不是渐进侵蚀。
