# Agent 内核架构收敛（Pi 教训 + 讨论决策）

> **文档性质：** notes（讨论收敛，非实现 Spec、非近期交付承诺）
> **状态：** 决策已收敛（2026-08）
> **关联：** [`agent-core.md`](../../spec/agent-core.md) · [`agent-core-roadmap.md`](agent-core-roadmap.md) · [`agent-runtime-product-direction.md`](agent-runtime-product-direction.md) · [`edge-local-models.md`](../llm/edge-local-models.md) · [`runtime-multilang.md`](runtime-multilang.md) · [`agent-eval-roadmap.md`](../evals/agent-eval-roadmap.md)

本文档记录一次从「Pi 教训」出发、逐层收敛到「内核完整模块清单 + 决策清单」的架构讨论。多数结论与现有 spec/notes 一致，本文聚焦**增量**（Pi 事实核验、性能认知校准、蒸馏误区、验收网关、多 agent 形态、A2A 通信、crate 拆分判据、subagent 定位、多语言 trade-off、event bus 设计），重叠部分只引用不重复。

---

## 0. 一句话定位

> **薄内核 + 重资产进程外 + 通信可插拔 + 模型分层分诊 + 能力边界验收网关锁死；native-first，卖点是隐私/离线/确定性，不是 cost，不打并行。**

---

## 1. 从 Pi 吸取的教训

### 1.1 事实核验（源码 `~/code/agent/pi`，HEAD v0.82.1）

| 断言 | 实测 | 结论 |
|---|---|---|
| `AgentSession` ~3300 行 | `packages/coding-agent/src/core/agent-session.ts` = 3324 行 | 精确 |
| `InteractiveMode` ~6000 行 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts` = 6036 行 | 精确 |
| `Agent` + `agent-loop` 相对薄 | `agent.ts` 577 行 / `agent-loop.ts` 792 行 | 成立 |
| 两套 compaction/session | `packages/agent/src/harness/agent-harness.ts`(1084 行) 自带 `harness/compaction/`，与 `coding-agent/core/compaction/` 并存 | 成立 |
| bun 单文件 release | `scripts/build-binaries.sh`（`bun build --compile`） | 成立 |
| `packages/ai` faux provider | `packages/ai/src/providers/faux.ts` | 成立 |
| 测试 suite harness | `packages/coding-agent/test/suite/harness.ts`（`registerFauxProvider` + `AgentSession`） | 成立 |
| ~16ms 渲染节流 | `packages/tui/src/tui.ts:309` `MIN_RENDER_INTERVAL_MS = 16` | 成立 |
| 扩展错误 `emitError` 隔离 | `packages/coding-agent/src/core/extensions/runner.ts` | 成立（注：可靠性隔离，非安全隔离） |
| headless 用 output-guard 分流 | `core/output-guard.ts` + `writeRawStdout`（print-mode / rpc-mode 用） | 成立 |

### 1.2 教训（该学 / 该避）

- **内核薄**：loop 只做 turn 状态机、tool 调度、emit 事件；UI 只消费 AgentEvent。
- **扩展不进进程**（sidecar）；**不 embed JS runtime**。
- **单一 loop 真理源**，禁双实现（harness 与 coding-agent 两套 compaction 是反面教材）。
- **防膨胀 = 文件组织纪律（目录规范 + 单文件行数克制 + lint 机器强制），不是 crate 拆分**——Pi 的教训是工程纪律缺失（单文件 3324 行无人限制），不是架构设计错误。

---

## 2. 性能：模型 daemon 化

**核心校准：HTTP 不是本地推理瓶颈，模型是否常驻才是。**

- loopback HTTP 固定开销 <5ms（TCP 建连 + header 解析 + KB 级 JSON 序列化）。
- 真正大头：模型冷加载（7B Q4 1–3 秒）+ prefill（长 prompt 几百 ms 到秒级）。
- 所以「IPC vs HTTP」是伪问题，「常驻 vs 按需加载」才是决策点。

**结论：模型做独立常驻 daemon，agent 走轻量 IPC 调用。** 理由与「扩展进 sidecar」同一条原则——模型 runtime 是重资产（依赖重、吃显存、升级频繁），不 embed 进 agent 二进制。daemon 化还顺带解决 KV cache 复用（prefix caching，agent 传 session id 复用前缀）。

**300ms 窗口的精确解读**：它是「首 token 出现」的预算，不是「完整回答」；且只对「已常驻 + 短 prompt」成立。长 system prompt 会让 prefill 突破 300ms，故延迟承诺必须分层（见 §3）。

---

## 3. 模型策略：offload + 验收网关

> 分层路由的完整 Tier 0–4 设计见 [`edge-local-models.md`](../llm/edge-local-models.md)（已含 router、本地小模型、DeepSeek 兜底）。本文只补两个**现有文档未系统覆盖的增量**。

### 3.1 蒸馏误区

- **蒸馏迁移不了能力，只迁移风格/格式/偏好**——7B 参数容量就是知识上限，logit 蒸馏不能让 7B 达到 70B 的 coding 水平。
- **LoRA 是效率手段不是能力手段**：正确用法 = 一基座 + N 个 adapter 按任务切换（省显存、可堆叠），不是「能力放大器」。
- 正确姿势：teacher 生成 SFT 合成数据 + 微调，而非传统 logit 蒸馏。
- **unsloth 是训练侧（CUDA/Triton）**，推理侧走 llama.cpp/MLX；真正工作量在「adapter → GGUF/MLX」转换链。已定产品原则（`edge-local-models.md`）：「Local = inference only，Train = MoonTide Cloud」与此一致。

### 3.2 验收网关 + failover（「效果差不多」的兑现机制）

「本地模型效果差不多」是**有条件成立**的，条件必须写成机制而非承诺：

```text
任务 → router 分诊 → 本地快路径 → 自动验收（schema/单测/格式检查）
                          ├ 通过 → 返回
                          └ 失败 → failover 升级云端强模型重做
```

可 offload 任务的四条**可判定特征**：输出可自动验证、输入输出空间小、上下文短、失败成本低。没有验收网关，7B 在 coding 场景会「生成看似能跑、验收一跑就崩」。

### 3.3 卖点定位

「省钱」在 DeepSeek 时代被严重削弱（本地是固定成本换边际成本，常驻 4–5GB 内存，offload 比例不够高就不省）。**本地模型真卖点是隐私 + 离线 + 确定性**，cost 只是附带收益。

---

## 4. 多 agent 形态与并行度分水岭

> 与 [`agent-core.md`](../../spec/agent-core.md) 非目标「不设计嵌套 agent 内核，多 agent 编排是组合层的事」一致，本节只补形态区分。

| 形态 | 本质 | cloud | native |
|---|---|---|---|
| Fan-out | 一任务拆 N 并行 | 强（并行=钱包） | 弱（并行=硬件上限） |
| Hierarchy | 主委派 sub | 都用大模型 | 独特优势：本地多模型梯度（1.5B→3B→7B） |
| Multi-session | N 独立会话 | 各自计费 | 共享 daemon，省内存 |

**并行度是 cloud/native 分水岭**：云端由钱包决定，本地由硬件决定（流式生成 batch=1，一台 Mac 跑一个 7B 推理流舒服，跑 4 个 thrash）。

**模型 daemon 是共享瓶颈资源**：多 agent 必须共享一个 daemon（否则 OOM），daemon 内置 queue + 优先级。

**调度器**是内核一等公民，回答四问：走哪个模型（分诊）、串行还是并行（fan-out）、本地忙时排队还是升级云端（failover）、多 agent 公平性。

**native-first 定位**：native 的护城河是「深度、隐私、低延迟的单机多模型分工」，不是并行；大规模 fan-out 后置 cloud 版。

---

## 5. 通信协议：A2A 语义 + 传输可插拔

**三层分离**：agent 只活语义层，协议层/传输层被抽象掉。

| 层 | 问题 | agent 该不该关注 |
|---|---|---|
| 语义层 | 传递什么业务含义（委派/回传/事件） | 只关注这层 |
| 协议层 | 说什么语言（JSON-RPC/schema） | 不关注 |
| 传输层 | 走什么通道（HTTP/TCP/Unix socket） | 不关注（可插拔） |

**A2A 不是 transport 协议，是语义层标准**，其官方 spec 自证「语义与传输分离」：

| A2A 层 | 内容 |
|---|---|
| Data Model | `Task` / `Message` / `AgentCard` / `Part` / `Artifact` |
| Operations | Send Message / Get Task / List Tasks / Cancel Task / Streaming |
| Bindings | JSON-RPC / gRPC / HTTP-REST（可插拔） |

（A2A：Google 创建，2025-06-23 捐给 Linux Foundation，v0.3 起支持 gRPC。）

**决策**：语义层直接采用 A2A 核心（`Task` 状态机 + `AgentCard`），不自己发明——自己发明 Task 状态机会在 `INPUT_REQUIRED` 这类边角态踩坑；传输层用 Bindings 可插拔（同机 Unix socket，跨机 gRPC），agent 代码零差异。

**第一版裁/留**：留 `Task` 生命周期 + `AgentCard` + 基本 Operations + 流式；裁 Agent Card 签名、extension 协商、security card。裁的是「将来补全」不是「将来重写」——语义从一开始就是 A2A 的，杜绝自研协议导致的将来重构。

---

## 6. crate 拆分判据

> 与 [`monorepo-packages.md`](monorepo-packages.md)、[`agent-harness-cli-split.md`](agent-harness-cli-split.md) 已有包结构讨论互补，本节补**判据本身**。

**crate 拆分的唯一硬价值 = 编译期依赖方向强制 + 跨二进制共享契约。** 防膨胀、代码清晰是 mod + lint 的事，和拆 crate 无关。

拆 crate 的四个真实理由（按强度）：

| 理由 | 含义 | 强度 |
|---|---|---|
| 依赖方向必须机器强制 | 编译器保证 A 永不 import B（cli → core 永不反向） | 最强 |
| 多二进制共享同一契约 | protocol 被内核/sidecar/daemon 同时依赖 | 强 |
| 独立发布 / 对外 SDK | 给第三方用、独立版本节奏 | 中 |
| 变更频率隔离（编译时间） | 规模到了才考虑 | 弱 |

不拆（同 crate，mod + lint 组织）的条件：概念内聚（共同演进、共同测试）、单一消费者、方向约束 review 守得住、拆的税 > 收益。

**两条纪律**：

- context/session/compaction/summary 用 mod 组织，**不拆 crate、不上 trait**；「多种更新」用策略模式在模块内部解决。
- **trait 按真实边界使用**：`LLMProvider` / `ToolExecutor` 是核心能力端口；event pipeline 等需要独立实现的窄边界也可使用 trait；不为「未来可能」或单实现逻辑提前上依赖倒置。

**落到本项目的结论：MVP 四 crate**（详见 §11、§15）：

- 拆：`cli`（纯壳）、`agent-tools`（第一方 builtins）、`agent`（组合根，唯一全依赖）。
- 不拆：`agent-core` 全家桶（loop/context/prompt/session/tools/scheduler/event/llm，见 §7）。
- 后置：`protocol` 独立 crate——MVP 单进程无跨二进制共享需求，先作 agent-core 内 `types/` mod，跨进程落地时再拆。

---

## 7. 完整内核模块清单

用「agent 完整生命周期」推演后，当前保留八个高内聚模块。早期曾把 permission 单独列为模块；2026-08-16 复核发现 MVP 只有静态 `tool_name → Allow | Ask` map 与一次查表，不足以形成独立领域边界，因此折叠为组合根配置和 loop 内部检查：

```text
agent-core/
  loop/          # turn 状态机 + steer/stop/continue + abort + retry
  context/       # item log → messages + compaction + summary + polish（策略模式）
  prompt/        # system prompt 组装（compile：skill/rules/tool schema 注入）
  session/       # item log 事实源 + 持久化 + load/resume
  tools/         # ToolSpec + frozen registry + 单次校验/执行/结果规范化
  scheduler/     # 分诊 + fan-out + delegate + 排队/升级（先模块后拆 crate）
  event/         # RunEvent bus + commit/derive pipeline + Agent Event Log
  llm/           # LLMProvider trait（多实现）
```

对应的边界纪律：

- `agent` 声明 `ToolPermissionMap`，`loop` 查表并处理 `Ask`；缺失项安全拒绝，sidecar 不可修改宿主 map。只有路径、命令前缀、session scope 或动态风险等真实规则出现后，才重新评审独立 permission 模块。
- `prompt/` ← 「compile 唯一出口」的落点（context 管动态消息历史，prompt 管静态指令骨架 + 动态注入，职责不同，不混入 context）。
- `event/` ← RunEvent 的统一分发落点；Session Item Log 是恢复事实源，Agent Event Log 是派生观测记录。

**两个「完整内核该有、但 MVP 可后置」的诚实标注**：

- 长时记忆（memory）：跨 session 记忆，第一版可不做，在 `session/` 旁留位。
- config 解析（resolveRunConfig）：更偏装配层（agent crate）而非内核，归属 agent crate。

---

## 8. MVP 边界与演进路线

**第一版（四 crate，证明架构成立）**：

```text
cli（纯壳，只消费 AgentEvent）
  → agent-core（loop/context/prompt/session/tools/event/llm 云端 provider）
  ← agent-tools（声明 catalog/builtins）；→ agent（组合根）
```

**后置（架构已验证后再上）**：

1. 本地 7B daemon + router 分诊（本地模型是优化，不是 MVP 前提）
2. 多 agent hierarchy（subagent = delegate tool，机制留接口）+ scheduler 拆 crate
3. unsloth 微调管线（adapter → GGUF/MLX 转换链）
4. slint 桌面壳
5. benchmark 全套

---

## 9. benchmark 设计

对比对象：pi-agent cli、codex cli、opencode cli、claude code cli（`cursor cli` 因模型路由受订阅控制、难以强制统一模型，公平性存疑，建议替换或标注特例）。

**统一模型时版本锁定**（同一 model id + 同一 provider endpoint + 同一温度），否则各 CLI 默认参数不同，结果无对比价值。

度量四维（基于「可自动验证」，不用 LLM-as-judge）：

1. 任务成功率（golden 答案任务，自动验证）
2. 成本（同模型下 token 消耗 / 完成任务费用）
3. 延迟（首 token / 任务完成时间）
4. 工具调用正确率（tool call schema 合规 + 参数正确）

**目的定位：工程导向**——不是证明 MoonTide 更强，而是找出「哪些任务 MoonTide 架构有优势、哪些是短板」，直接喂回分层设计。

---

## 10. 其余 crate 设计（除 agent-core）

### 10.1 依赖方向总图

```text
                    agent-core（引擎，含 tools runtime contract）
                    ↑        ↑            ↑
              cli（纯壳） agent-tools（builtins） agent（组合根，全依赖）
                                  ↑
                          （后置）runtime：daemon(Rust) / sidecar(语言未定)
                          （后置）protocol 独立 crate（跨进程契约）
```

依赖铁律四条：

1. **agent-core 不依赖 cli / agent / runtime**——它们依赖 agent-core，永不反向。
2. **agent-tools 单向依赖 agent-core**——只提供第一方 `ToolDefinition` catalog 与具体 executor；agent-core 不反向依赖 builtins。
3. **agent 是唯一全依赖的组合根**——同时依赖 agent-core + agent-tools + preset 配置 +（后置的）runtime client。
4. **runtime 与 agent-core 对等**——只通过（后置的）protocol 契约通信，互不 import。

### 10.2 cli

纯壳，只消费 AgentEvent，**不含任何编排逻辑**（Pi 的 InteractiveMode 6036 行就是编排塞进 UI 的反面教材）：

```text
cli/
  args.rs        # clap 定义
  repl/          # REPL 循环、输入处理
  render/        # ratatui：订阅 AgentEvent 差分渲染（节流 redraw）
  emit.rs        # --emit jsonl：AgentEvent → stdout
```

`desktop`（slint）与 cli 平行、结构相同、后置——两者都只订阅 AgentEvent，是「UI 是壳、内核不依赖 UI」的落地。

### 10.3 agent（组合根）

薄到极致，只做装配，零逻辑：

```text
agent/
  preset/        # skill、rules、tool name、permission、prompt 的声明式配置
  bootstrap.rs   # 组合根：new AgentCore(store, ctx, tools, llm, ...) 注入
```

`resolveRunConfig` / config 解析归属这里。bootstrap 按 preset name 从 `agent-tools::builtin_tool_definitions()` 选择、build 并冻结 `ToolRegistry`。独立成 crate 的理由是**依赖方向**——它同时依赖 agent-core + agent-tools + preset +（后置的）runtime，是唯一「全依赖」的 crate，desktop 复用。

### 10.4 protocol（后置，先 mod 后 crate）

MVP 单进程，无跨进程通信，故不独立成 crate；类型定义（RunEvent、Message、ModelRequest…）先作 agent-core 内 `types/` mod。**拆独立 crate 的触发条件**：模型 daemon / 多 agent / 跨进程真正落地时——那时它才获得「跨二进制共享契约」的价值。

**Transport 抽象已定（帧抽象），后置实现**：

```rust
pub enum Frame {
    Request { id: u64, method: String, params: serde_json::Value },
    Response { id: u64, result: serde_json::Value },
    Error { id: u64, code: i32, message: String },
    Event { topic: String, payload: serde_json::Value },
}

pub trait Transport: Send + Sync {
    fn request(&self, method: &str, params: serde_json::Value) -> FrameStream;
    fn subscribe(&self, topic: &str) -> FrameStream;
}
```

- 帧抽象（非字节流、非 RPC）：Transport 管「可靠传输帧序列」，序列化统一在 protocol 层。
- JSON 帧（NDJSON 第一版）：消费者有 Rust + TS 两种语言，JSON 是唯一语言中立的序列化；A2A 基于 JSON-RPC，天然契合。
- 实现：Unix socket（第一版），TCP/gRPC（后置跨机）。

**schema auto-gen 工具后置**：现在只定 serde（序列化无论如何都要）；schemars / ts-rs / prost 的选择，等「跨语言契约」真实出现时再拍（schemars 的顾虑：生成的 JSON Schema 偏「Rust 味」，对 TS codegen 不友好；ts-rs 跳过中间层更直接）。

---

## 11. subagent 与嵌套限制

### 11.1 subagent = 一个 tool，且 = 同一二进制的 role 实例

- **core 视角**：subagent 是 `delegate` tool，和读文件、跑 grep 无区别——**core 不知道、也不关心**它背后是子 agent、普通函数、还是本地 7B offload。
- **实现**：delegate tool 走 Transport 调**同一个 Rust 二进制的另一个实例**（`moontide agent --role sub`），不是另一套代码、不是另一种语言。

```text
同一个 AgentCore，运行时被启动多次
  --role main   → 用户 prompt 驱动的主 agent
  --role sub    → delegate tool 驱动的子 agent（同一份 agent-core 代码）
```

### 11.2 不用继承层次（BasicAgent → MainAgent/SubAgent）

main 和 sub 本质是**同一种东西——一个 Run**，差异全在 preset 配置，不在类型：

| 差异维度 | 性质 | 表达 |
|---|---|---|
| tool 集不同 | 配置 | `Preset.tools` |
| 权限不同 | 配置 | `Preset.permission` |
| 模型不同 | 配置 | `Preset.model_tier` |
| prompt 不同 | 配置 | `Preset.system_prompt` |
| 执行逻辑（loop/session/context/tool 调度） | 完全相同 | agent-core 引擎 |

继承层次会让 `AgentCore` 被迫感知「主/子」角色，破坏「core 不知道子 agent」和「subagent 是一个 tool」两条原则。配置 + 组合才是 Rust 里「同一引擎、多个角色」的正确表达。

### 11.3 嵌套与数量限制：能力集合 + 运行时配额，不是类型

| 诉求 | 本质 | 落点 |
|---|---|---|
| subagent 不能再委派（禁嵌套） | 能力集合差异 | sub 的 `Preset.tools` **不含 `delegate`**（装配期排除，不是运行时拒绝） |
| main 创建 sub 有数量限制 | 运行时配额 | delegate tool 内计数 + `DelegatePolicy` |

```rust
struct DelegatePolicy {
    max_nesting_depth: u32,   // main=1（可委派一层），sub=0（禁嵌套）
    max_concurrent_subs: u32, // 同级数量上限
}

impl Tool for DelegateTool {
    async fn call(&self, task: String) -> ToolResult {
        if self.depth >= self.policy.max_nesting_depth { return Err("nesting depth exceeded"); }
        if self.concurrent >= self.policy.max_concurrent_subs { return Err("subagent quota exceeded"); }
        // 通过 Transport 启动 sub，传入 sub preset（tools 不含 delegate）
    }
}
```

`max_concurrent_subs` 正是 §4 调度器「多 agent 公平性/配额」那一问的具体化。防递归爆炸 + 资源耗尽是真实需求，但落点是 preset 配置 + 运行时配额，不引入 phantom type（其代价：泛型传染 + 破坏 main/sub 同构，只换来两个限制里一半的编译期保证，不符合简单冗余，后置到真实 bug 发生再考虑）。

---

## 12. 多语言与 runtime trade-off

### 12.1 先拆账：runtime 代价不是铁板一块

| runtime 形态 | 体积 | 内存基线 | 启动 | 依赖 |
|---|---|---|---|---|
| Go 静态二进制 | 2–5MB（strip 后 ~1–2MB） | 几 MB | 几十 ms | 无（静态链接） |
| Rust 静态二进制 | 2–5MB | 几 MB | 快 | 无 |
| Node | 几十 MB（embed 更大） | 几十 MB | 100ms+ | 外部 runtime |
| Bun embed（Pi） | 30–40MB | 几十 MB | 慢 | embed |

**关键：Go 和 Rust 的 runtime 代价同数量级（静态二进制），Node 才是另一个量级。** Pi 的 30–40MB 教训是 Node/Bun 的账，不是 Go 的账。

### 12.2 税的三分类（AI 时代的判断框架）

| 税 | 内容 | AI 能缩减吗 |
|---|---|---|
| 人力税 | 学语言、写代码、样板、翻译 | ✅ 大幅缩减 |
| 运行时税 | 多 runtime = 用户多付内存/启动/体积/升级 | ❌ 缩减不了，是用户代价 |
| 契约税 | 跨语言边界 schema 漂移、序列化 bug、排查 | ⚠️ 部分（AI 帮写，边界 bug 还得人查） |

**AI 时代稀缺资源从「写代码的人力」变成「正确性的可验证」**——所以判断标准从「人力成本」迁移到「运行时成本 + 契约成本」，而这两项正是性能/用户体验/工程化本身。

### 12.3 结论：Rust 单语言起步，Go 定方向、后置引入

- **subagent / 模型推理**：必须 Rust（复用 agent-core、llama.cpp 绑定），Go 无资格。
- **后台监控/代理**（日志监控、agent 状态监控、请求代理）：Go 的甜蜜区（并发 I/O 密集、非 CPU bound、goroutine 心智负担低），但 MVP 用 Rust tokio 先写。
- **引入 Go 的触发信号**：后台服务复杂到 tokio 真痛（几十个 agent 并发监控、请求网关）——那一刻甜蜜区差异真实压过第三语言的税，届时引入，且按需启动、opt-in 安装。
- **多语言成立的四前提**：职责不重叠（Rust 内核/推理、Go 监控/代理、TS 扩展生态）、甜蜜区差异真实、边界用 JSON 契约不共享代码、团队撑得起。

---

## 13. event bus 设计（Rust 无动态加载插件）

### 13.1 关键区分：Event（单向广播）≠ Hook（双向决策）

| | Event | Hook |
|---|---|---|
| 方向 | 内核 → 订阅者，单向 | 内核 ⇄ hook，双向 |
| 内核是否等待 | 不等（fire-and-forget） | 等决策（blockable） |
| 用途 | UI 渲染、持久化、遥测、sidecar 观察 | beforeToolUse、llmCall 拦截/改参 |
| 语义 | 「发生了什么」 | 「该不该继续 / 怎么改」 |

`spec/agent-core.md` 已区分（Hook 返回决策，Event 供观察者）。event bus 只负责 Event，Hook 是另一套机制。

### 13.2 Event bus：tokio broadcast

```rust
#[derive(Clone, Serialize, Deserialize)]
pub enum RunEvent {
    RunStarted { run_id: String },
    TurnStarted { turn_id: u64 },
    LlmCallStarted { /* ... */ },
    BeforeToolUse { tool: String, params: Value },
    ToolFinished { tool: String, result: Value },
    RunFinished { /* ... */ },
}

pub struct EventBus {
    tx: broadcast::Sender<Arc<RunEvent>>,   // Arc：多订阅者共享
}
impl EventBus {
    pub fn publish(&self, e: RunEvent) { let _ = self.tx.send(Arc::new(e)); }
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<RunEvent>> { self.tx.subscribe() }
}
```

三个进程内订阅者：持久化（写 Run JSONL）、cli render（差分渲染 + 节流）、bridge（发 sidecar）。

### 13.3 「插件」接入：bridge 是进程内到跨进程的桥梁

Rust 不能动态加载 JS 插件（Node 的 `import()` + jiti），所以 sidecar 插件通过一个 **bridge 订阅者** 接入——它是 event bus 的普通订阅者，把事件序列化后经 Transport 单向推给 sidecar：

```rust
struct Bridge { transport: Arc<dyn Transport> }
impl Bridge {
    async fn run(mut rx: broadcast::Receiver<Arc<RunEvent>>) {
        while let Ok(e) = rx.recv().await {
            let json = serde_json::to_vec(&*e)?;
            self.transport.send_event("run", &json).await;  // 单向推送，不等
        }
    }
}
```

### 13.4 Hook：注册 + 折叠器 + 同步等决策

sidecar 要**影响内核决策**，走 Hook（run 启动时注册、折叠一次、run 内不可增删）：

```rust
type Hook = Box<dyn Fn(HookInput) -> HookDecision + Send + Sync>;
struct HookRegistry { before_tool_use: Vec<Hook>, llm_call: Vec<Hook> }

struct SidecarHook { transport: Arc<dyn Transport> }
impl SidecarHook {
    async fn invoke(&self, input: HookInput) -> HookDecision {
        // 同步：发 request，等 sidecar 返回 decision（blockable）
        self.transport.request("beforeToolUse", json!(input)).await
    }
}
```

差异一目了然：bridge 的 `send_event` 单向异步（Event 语义），SidecarHook 的 `request` 双向同步（Hook 语义）。分开实现，内核永握时序权威——sidecar 挂了，bridge 丢弃事件不阻塞内核，SidecarHook 超时走保守默认决策。

---

## 14. 决策清单

### 14.1 已收敛的架构决策

1. 内核：Rust 单 loop，薄内核——只握 session 写权 + tool 执行权
2. 重资产：全部进程外（sidecar、daemon、后台 work）
3. subagent = 一个 tool，= 同一 Rust 二进制的 `--role sub` 实例，非独立类型
4. 嵌套/数量限制 = preset 配置 + 运行时配额（DelegatePolicy）
5. crate 判据：依赖方向强制 + 跨二进制共享契约；防膨胀 = mod + lint
6. MVP crate：`cli` + `agent-core` + `agent-tools` + `agent`；protocol 先 mod 后 crate
7. 内核模块：loop / context / prompt / session / tools / scheduler / event / llm；permission 当前是组合根 map + loop 查表，不是独立模块
8. 模型分层：router 分诊 → 本地 7B（验收网关 + failover）→ 云端兜底
9. 微调：unsloth（训练）+ llama.cpp/MLX（推理），adapter→GGUF 转换链
10. 卖点：隐私 / 离线 / 确定性，不打并行
11. 通信：A2A 语义 + 传输可插拔（帧抽象 + JSON），MVP 单进程暂不落地
12. 多语言原则：新语言由「真实甜蜜区差异」买单；边界 JSON 契约，不共享代码

### 14.2 已拍板的战略决策（D1–D6）

| # | 决策 | 结论 |
|---|---|---|
| D1 | MVP 语言栈 | Rust 单语言起步，Go/TS 后置 |
| D2 | MVP 模型起点 | 先云端 DeepSeek provider，本地 7B 后置 |
| D3 | MVP 扩展面 | 纯 MCP，深 hook/sidecar 后置 |
| D4 | 多 agent 进 MVP | 后置，单 agent 起步，delegate tool 留接口 |
| D5 | benchmark 时机 | 尽早小规模（工程导向） |
| D6 | Go 后台服务 | 定方向、后置引入，按需启动 |

### 14.3 后置决策（触发条件明确）

| 决策 | 触发条件 |
|---|---|
| protocol 拆独立 crate | 模型 daemon / 多 agent / 跨进程落地 |
| schema auto-gen 工具（schemars/ts-rs/prost） | 跨语言契约真实出现 |
| 本地 7B daemon + router | 内核架构被 MVP 验证后 |
| sidecar 语言（TS/Go/Rust） | 深 hook 生态真要设计时 |
| Go 后台服务引入 | 后台服务复杂到 tokio 真痛 |

---

## 15. 开放问题（讨论中未收敛）

已收敛（前几轮遗留、本轮解决）：语言/双轨终局（D1）、MVP 边界（§8 四 crate）。

仍待后续决策（实现细节，非架构）：

1. **7B 具体选型 + LoRA 训练资源**：基座版本；训练在云 GPU 还是本机。
2. **300ms 实测**：把「~ms/~秒」估算换成本机真数（llama.cpp/MLX 基准）。
3. **router 冷启动分诊**：无 teacher 决策数据时如何分诊。
4. **验收网关覆盖面**：每类 offload 任务的验收断言定义与工作量。
5. **调度器优先级策略**：多 agent 共享 daemon 时谁先跑。
6. **A2A 裁剪精确边界**：裁/留清单到 schema 级。
