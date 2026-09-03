# LLM Provider 与启动配置修复计划

> **状态：** 已完成实现与独立复审（2026-08-26，待用户 diff review）
> **目标版本：** Agnes provider / startup layering 当前未提交批次的修复版
> **关联：** [`agnes-provider-integration.md`](agnes-provider-integration.md) · [`startup-config-layering.md`](startup-config-layering.md) · [`../agent-core/DESIGN.md`](../agent-core/DESIGN.md#llm) · [`../agent/DESIGN.md`](../agent/DESIGN.md) · [`../cli/DESIGN.md`](../cli/DESIGN.md)

## 1. 问题与目标

当前未提交实现已经建立 typed provider catalog、CLI/Desktop 四层启动配置和 Agnes OpenAI-compatible 映射，但仍有四类工程问题：

1. concrete vendor catalog 位于 `agent-core`，使 provider-neutral engine 持有产品装配策略；
2. provider、model、base URL、credential 被当成完全独立字段，可能形成跨 provider 的错误组合；
3. CLI `/settings` 切换 provider 后，旧 Model/Base URL projection 会覆盖新 catalog defaults；
4. settings schema、resolved provider facts 与 OpenAI wire extension 存在重复 owner 或字符串推断。

本修复把配置收敛为一条明确链路：

```text
CLI / Desktop host-owned settings parser
  -> agent::llm::LlmConfigLayer
  -> provider-scoped four-layer merge
  -> agent::llm::ResolvedProviderConfig
  -> AgentConfig { provider: ResolvedProviderConfig, ... }
  -> agent bootstrap
  -> adapter-specific config
  -> OpenAI normalize encode(request, options)
```

## 2. 已确认决策

1. CLI `/settings` 切换 provider 时，同时刷新 catalog 中显示的 Model/Base URL entries，并清空旧 credential。
2. concrete provider/model catalog 从 `agent-core` 移至 `agent::llm`；`agent-core` 只保留 provider-neutral protocol、adapter 与 normalize。
3. settings schema 与文件 IO 由宿主持有。CLI/Desktop 各自读取文件并构造 `LlmConfigLayer`；`agent::llm` 不读取 settings 文件，也不声明宿主 settings schema。
4. provider identity、model、family、base URL、credential 与 adapter options 收敛为一个 `ResolvedProviderConfig`；`AgentConfig` 只持有一个 `provider` 字段。
5. 显式空白 model/base URL 在 host/env layer 构造时返回错误，不能被当成缺省值或延迟到 adapter 失败。
6. Agnes thinking extension 由 resolved provider config 显式传给 OpenAI adapter/normalizer，不再通过 model id 前缀推断。
7. catalog 使用穷尽 `match` 或 provider-owned model slice 表达完整性，使非法 provider/model table 状态不可构造，不依赖 production `expect`。
8. 当前设计、使用说明、任务状态、测试契约注释和文档索引随实现同步修复。

## 3. 关键设计

### 3.1 Ownership

| Owner | 负责 | 不负责 |
|---|---|---|
| `agent-core::llm` | canonical model protocol、adapter family、adapter-specific config、HTTP/SSE、wire encode/decode | concrete vendor/model catalog、settings schema、env 名、provider defaults |
| `agent::llm` | `ProviderId`、concrete catalog、provider-scoped merge、credential env registry、`ResolvedProviderConfig` | 读取 CLI/Desktop settings 文件、stdin/UI |
| CLI / Desktop | settings schema/version、JSON IO、host 参数、调用 env reader、构造 `LlmConfigLayer` | vendor table、wire JSON policy |
| `AgentConfig` | 已解析 runtime 配置 | 再次执行 precedence、读取 settings/env |

不新增 crate，不引入数据库、兼容框架或通用 WireProfile 系统。

### 3.2 Provider-scoped merge

四层优先级保持：

```text
catalog < settings < environment < host overrides
```

但 model、base URL、API key 是 provider-scoped fields，不是无条件跨 provider 继承的自由字段。

合并规则：

1. 先按层优先级确定 `final_provider`；
2. 以 `final_provider` 的 catalog defaults 建立 model/base URL/family/adapter-options baseline；
3. settings layer 若声明的 provider 与 `final_provider` 不同，忽略该层的 model/base URL/API key；version 1 缺 provider 时由 host 迁移为 DeepSeek；
4. environment/host layer 的显式 model/base URL 作用于最终 provider；provider-specific env key 只选择 `final_provider` 对应候选；
5. host API key 最高；任何 provider 切换都不能携带低层其他 provider 的 credential；
6. family 与 adapter options 只能由 catalog 解析，不接受 host 直接覆盖；
7. model/base URL 的 `Some("")` 或全空白输入在 layer 构造时失败。

必须守住：

```text
resolved.provider_id == catalog/provider scope of defaults and credentials
```

允许显式 custom base URL，但它必须来自对最终 provider 生效的 environment/host field，而不是旧 provider settings 的残留默认值。

### 3.3 Resolved provider

目标类型表达一个不可拆分的 runtime provider 事实：

```rust
pub struct ResolvedProviderConfig {
    pub provider_id: ProviderId,
    pub model: String,
    pub family: AdapterFamily,
    pub base_url: String,
    pub api_key: String,
    pub openai_chat: OpenAiChatOptions,
}

pub struct AgentConfig {
    // cwd / persistence / tools / limits ...
    pub provider: ResolvedProviderConfig,
}
```

名称可在实现中小幅调整，但 `AgentConfig` 不得再平行持有 `provider_id`、`model` 和另一份 provider fields。

Secret-bearing 类型的 `Debug` 必须脱敏或不实现；不得把 raw API key 写入错误、日志或测试输出。

### 3.4 Adapter-specific thinking option

`agent::llm` 根据 catalog entry 解析 Agnes 的 OpenAI adapter option。`agent-core` 只接收 provider-neutral 的 adapter-specific value，例如：

```rust
pub enum OpenAiThinkingExtension {
    None,
    ChatTemplateKwargs,
}
```

OpenAI adapter 把该 option 传给 `encode_request`；normalize 根据 option 与 canonical `ThinkingLevel` 生成 JSON。normalize 不读取 `ProviderId`，也不检查 model id 前缀。

不为未来厂商增加尚无 consumer 的通用 compatibility registry。

### 3.5 CLI settings projection

Provider entry cycle 后必须原子刷新：

- Provider current value；
- Model current value 与 values；
- Base URL current value；
- runtime API key 清空。

`sync_to_runtime` 不得再让旧 projection 覆盖刷新结果。测试必须使用生产形态的完整 catalog，而不是 provider-only synthetic catalog。

## 4. 非目标

- 不新增 provider、model 或 adapter family；
- 不实现 OpenAI Responses、Anthropic Messages HTTP 或多 provider routing；
- 不改变 Session Item Log、Turn/Step、permission 或 Desktop protocol；
- 不设计 per-provider credential vault；settings version 2 仍只有当前 provider 的 credential；
- 不提交、push 或创建 PR，直到用户完成 diff review 并明确授权。

## 5. Work Packets 与任务

### Review 批总览

| 批 | TASK | 主题 | 依赖 | 预计 |
|---|---|---|---|---|
| Fix R1 | 01–03 | catalog ownership、resolved provider、adapter option | 无 | 约 700–1100 行 |
| Fix R2 | 04–06 | host-owned schema、provider-scoped merge、settings UI | R1 的公开类型 | 约 600–1000 行 |
| Fix R3 | 07–08 | 跨宿主测试、文档与交付证据 | R1–R2 | 约 400–800 行 |

### TASK-fix-01：catalog 移至 agent

- **做什么：** 将 concrete provider/model/default endpoint/env registry 移至 `agent::llm::catalog`；provider entry 直接拥有 model slice，并用穷尽映射消除 catalog production panic。
- **范围：** `crates/agent-core/src/llm/catalog/**`、`crates/agent/src/llm/catalog/**`、相关 re-export/tests。
- **完成标准：** `agent-core` 源码不包含 Agnes/DeepSeek catalog；catalog coverage/fallback tests 通过。
- **状态：** 完成。

### TASK-fix-02：单一 ResolvedProviderConfig

- **做什么：** 合并 `ProviderConfig`、`ResolvedAgentProvider` 与 `AgentConfig` 中平行 provider/model 字段；bootstrap 与 reload 只消费一个 resolved provider value。
- **范围：** `crates/agent/src/{config,bootstrap,agent,llm,lib,tests}.rs` 及直接构造 `AgentConfig` 的测试。
- **完成标准：** `AgentConfig` 只有一个 provider 字段；不存在可独立矛盾的 `provider_id`/`model` 字段。
- **状态：** 完成。

### TASK-fix-03：显式 OpenAI adapter option

- **做什么：** 用 resolved provider config 明确传递 Agnes thinking extension；OpenAI normalize 不再根据 model 前缀推断。使 adapter family/config 组合尽量在类型上合法。
- **范围：** `crates/agent-core/src/llm/{adapter,normalize}/**`、`agent` provider resolution 与对应 tests。
- **完成标准：** 全仓库不存在 `starts_with("agnes-")` wire 判定；Agnes on/off 与 DeepSeek no-extension tests 通过。
- **状态：** 完成。

### TASK-fix-04：settings schema 与空值校验归宿主

- **做什么：** 删除 `agent::llm` 的 settings 文件 reader/schema；CLI/Desktop 各自解析 settings 并构造 layer；host/env 构造时拒绝空白 model/base URL。
- **范围：** `crates/agent/src/llm/persisted.rs`、`crates/cli/src/settings.rs`、`crates/moontide-desktop/src-tauri/src/bootstrap.rs` 与 tests。
- **完成标准：** `agent` 不读 settings 文件；两宿主的损坏/version/blank tests 明确。
- **状态：** 完成。

### TASK-fix-05：provider-scoped merge

- **做什么：** 按 §3.2 实现 final-provider baseline 与 scoped field/credential precedence，阻止跨 provider endpoint/key 组合。
- **范围：** `crates/agent/src/llm/startup.rs` 及纯 merge tests。
- **完成标准：** DeepSeek settings + Agnes env/host 等反例得到完整 Agnes bundle，旧 DeepSeek key/URL 不进入结果。
- **状态：** 完成。

### TASK-fix-06：刷新 CLI settings entries

- **做什么：** Provider cycle 同步刷新 Model/Base URL projection 和 runtime state，保留 reload/rollback 行为。
- **范围：** `crates/cli/src/{setting_catalog,settings,tests}.rs`。
- **完成标准：** 完整 production-shaped catalog 回归测试证明切换后 entries/store 都是 Agnes defaults 且旧 key 清空。
- **状态：** 完成。

### TASK-fix-07：跨宿主与结构验收

- **做什么：** 补齐 settings < env < host、CLI/Desktop 同输入等价、blank、credential isolation、resolved provider 与 adapter option tests；补齐测试契约注释。
- **范围：** `agent-core`、`agent`、`cli`、`moontide-desktop` 相关 tests。
- **完成标准：** focused tests 通过；`just check` 通过或记录可复现 toolchain blocker。
- **状态：** 完成；Rust 1.97.1 下 `just check` 通过。

### TASK-fix-08：文档同步

- **做什么：** 将所有当前文档改为本计划确认的 ownership、merge、resolved type 与 adapter option；修复状态、索引、`.env.example` 和 ignored/broken link。
- **范围：** 本文关联文档、`.agents/skills/moontide-kernel-plan/CONTEXT.md`、`.env.example`、`crates/docs/README.md`、`docs/product/README.md`。
- **完成标准：** 文档不再宣称 catalog 位于 core、agent 读取 settings 文件或 normalize 按 model 前缀推断；所有新增链接可由 Git 跟踪。
- **状态：** 完成；已按 live `ResolvedProviderConfig`、`AdapterConfig` 与 host parser API 做 exact-name final pass。

## 6. 并行所有权与集成顺序

| Work Packet | Owner 路径 | 不得修改 |
|---|---|---|
| A：TASK 01–03、05 | `crates/agent-core/src/llm/**`、`crates/agent/src/{llm,config,bootstrap,agent,lib,tests}.rs` | CLI/Desktop production files、设计文档 |
| B：TASK 04、06、host tests | `crates/cli/src/**`、`crates/moontide-desktop/src-tauri/src/bootstrap.rs`、直接 host fixture tests | agent/core implementation、设计文档 |
| C：TASK 08 | 本计划列出的 Markdown、`.env.example`、索引 | Rust production/test files |

共享文件或公开 API 变化以 Work Packet A 为准。B 发现 A 的目标 API 尚不可用时应等待或适配 live source，不得复制临时 catalog/merge 实现。集成顺序：A → B → C 最终校正 → TASK 07 validation/review。

所有 subagent 都在同一 worktree；不得 reset、stash、clean、覆盖其他 agent 修改或 broad-stage。

## 7. Shared Acceptance

1. Provider 切换后 model/base URL/family/API key/adapter option 形成同一 provider-scoped resolved value；
2. Agnes credential 不可能因低层残留默认值发往 DeepSeek endpoint，反向同理；
3. `AgentConfig` 只有一个 resolved provider fact；
4. `agent-core` 不拥有 concrete vendor catalog，normalize 不读取 vendor identity/model prefix；
5. `agent` 不读取 settings 文件，CLI/Desktop 显式构造 `LlmConfigLayer`；
6. `/settings` Provider、Model、Base URL entries 与 runtime store 同步；
7. 显式空白 model/base URL 在 layer construction 失败；
8. focused tests、workspace gate或明确环境 blocker、独立 Standards/Spec review 与用户 diff review都有可复现证据。

## 8. 风险与停止条件

- 如果实现要求改变 settings version 2 的持久化形状，停止并请求用户确认；
- 如果 adapter option 必须进入 `ModelRequest` 或 Session Item Log，停止并重新对齐 ownership；
- 如果 CLI 与 Desktop 无法在不共享 schema 的情况下保持同一 LLM layer 语义，记录反例并请求决定，不新建 speculative config crate；
- 如果需修改本批以外的 Desktop protocol、Loop 或 Session 契约，停止扩展范围。

## 9. 验证命令

```bash
cargo fmt --all --check
cargo test -p agent-core --offline
cargo test -p agent --offline
cargo test -p cli --offline
cargo test -p moontide-desktop --offline
just check
```

当前环境曾以 Rust 1.85 因依赖 MSRV 失败；重新验证时必须先记录 `rustc --version`，并把 toolchain blocker 与代码失败分开。
