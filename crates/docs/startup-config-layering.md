# 启动配置四层合并

> **状态：** 当前设计（2026-08-26 已实现并通过门禁，待用户 diff review）
> **范围：** CLI / Desktop 启动时的 provider、model、base URL、adapter option 与 API key
> **关联：** [`llm-provider-config-fix.md`](llm-provider-config-fix.md) · [`agnes-provider-integration.md`](agnes-provider-integration.md) · [`../agent/DESIGN.md`](../agent/DESIGN.md) · [`../cli/DESIGN.md`](../cli/DESIGN.md)

## 1. 结论

LLM 启动配置只有四个有序层：

```text
catalog < settings < environment < host overrides
```

这不是无条件的字段覆盖。model、base URL 和 API key 都是 provider-scoped fields：
高层切换 provider 后，低层其他 provider 的 endpoint、model 和 credential 不能继续存活。

最终链路固定为：

```text
CLI / Desktop host-owned settings schema + JSON IO
  → LlmConfigLayer
  → agent::llm provider-scoped merge
  → ResolvedProviderConfig
  → AgentConfig { provider, ... }
  → adapter config + explicit adapter option
```

## 2. Ownership

| Owner | 负责 | 不负责 |
|---|---|---|
| `agent-core::llm` | canonical protocol、`LLMProvider`、adapter family、HTTP/SSE、wire encode/decode、provider-neutral adapter option types | concrete vendor/model catalog、env 名、settings schema |
| `agent::llm` | `ProviderId`、concrete catalog、provider-scoped merge、env registry、`ResolvedProviderConfig` | 读取 settings 文件、stdin/UI |
| CLI / Desktop | 各自的 settings schema/version、JSON IO、host 参数、构造 `LlmConfigLayer` | vendor table、wire JSON policy |
| `AgentConfig` | 一个已解析的 provider runtime fact | 再次执行 precedence、读取 settings/env |

不新增共享 settings crate。CLI 与 Desktop 可以拥有各自的宿主 schema，但映射到同一个
`LlmConfigLayer` 语义。损坏 JSON、未知版本和 version 1 migration 都在宿主边界处理。

## 3. Layer 定义

| 层 | 来源 | 可提供字段 | 规则 |
|---|---|---|---|
| catalog | `agent::llm::catalog` | provider、default model/base URL、family、adapter options、credential env name | 默认 provider 的完整 baseline；不存 secret |
| settings | `<cwd>/.moontide/settings.json` | provider、model、base URL、API key | 由宿主解析；version 1 缺 provider 时由宿主迁移为 DeepSeek |
| environment | `MOONTIDE_PROVIDER`、`MOONTIDE_MODEL`、`MOONTIDE_BASE_URL`、provider-specific key | provider、model、base URL、API key candidates | 最终 provider 只选择自己的 credential env；空白 model/base URL 报错 |
| host overrides | CLI flags、Desktop 显式输入 | provider、model、base URL、API key | 只有显式 `Some` 覆盖；空白 model/base URL 报错 |

`family` 与 adapter options 不能由 settings/env/host 直接覆盖，只能从 final provider 的
catalog entry 解析。自定义 base URL 可以存在，但必须由对 final provider 生效的显式
environment/host field 提供，不能来自旧 provider settings 残留。

## 4. Provider-scoped merge

### 4.1 算法

1. 依次查看 settings、environment、host 的 provider，确定 `final_provider`。
2. 从 `final_provider` 的 catalog entry 建立 model/base URL/family/adapter-options baseline。
3. settings 若声明同一个 `final_provider`，其 model/base URL/API key 才可参与；若声明
   其他 provider，则三个字段全部忽略。
4. environment/host 对 final provider 显式提供的 model/base URL 依优先级覆盖 baseline。
5. API key 按同 provider settings < final-provider env candidate < host 合并。
6. family 与 adapter options 保持 catalog 派生，不接受高层覆盖。
7. 产出单一 `ResolvedProviderConfig`；之后不再重跑 precedence。

必须守住：

```text
resolved.provider_id == scope(resolved.model, base_url, api_key, adapter options)
```

### 4.2 典型反例

输入：

```text
settings: provider=deepseek, base_url=https://api.deepseek.com, api_key=deepseek-secret
environment: MOONTIDE_PROVIDER=agnes, AGNES_API_KEY=agnes-secret
host: empty
```

结果必须是完整 Agnes bundle：

```text
provider=agnes
model=agnes catalog default
base_url=https://api.agnes-ai.cn/v1
api_key=agnes-secret
openai thinking extension=ChatTemplateKwargs
```

DeepSeek URL/key 都不能进入结果。反向切换同理。

### 4.3 Blank validation

以下值不是“缺省”，而是来源明确的配置错误：

```text
MOONTIDE_MODEL="   "
MOONTIDE_BASE_URL=""
--model ""
--base-url "   "
settings.model/base_url 显式全空白
```

settings/host/env 在构造 `LlmConfigLayer` 时拒绝这些值；不能静默回退 catalog default，
也不能拖到 adapter/HTTP 阶段才失败。provider-specific API key 的空白值按 credential
规则视为缺失，不可覆盖有效的更低层同 provider key。

## 5. 目标类型

以下是契约级伪代码，具体命名可随实现微调：

```rust
pub struct LlmConfigLayer {
    // fields are not public outside agent
}

impl LlmConfigLayer {
    pub fn new(
        provider_id: Option<ProviderId>,
        model: Option<String>,
        base_url: Option<String>,
        api_key: Option<String>,
    ) -> anyhow::Result<Self>;
}

pub struct LlmEnvLayer {
    pub values: LlmConfigLayer,
    pub provider_api_keys: BTreeMap<ProviderId, String>,
}

pub struct ResolvedProviderConfig {
    pub provider_id: ProviderId,
    pub model: String,
    pub family: AdapterFamily,
    pub base_url: String,
    pub api_key: String,
    pub openai_chat: OpenAiChatOptions,
}

pub struct AgentConfig {
    pub provider: ResolvedProviderConfig,
    // cwd / persistence / tools / limits ...
}
```

`AgentConfig` 不再平行持有 `provider_id`、`model` 与另一份 provider fields。
secret-bearing 类型不得在 `Debug`、错误或日志中暴露 raw API key。
`LlmConfigLayer::new` 是宿主公开构造边界；present-but-blank model/base URL 在这里
返回错误，merge 入口还会防御性复验内部 layer。

## 6. Catalog 完整性

concrete catalog 位于 `agent::llm::catalog`。每个 `ProviderEntry` 直接拥有自己的 model
slice；provider lookup 使用穷尽 `match`。default model 来自同一个 provider-owned
entry，避免“表中遗漏 enum/default model 后在 production `expect`”的状态。

新增 provider 时只改 `agent::llm` catalog 与对应验收，不修改 `agent-core`、CLI 或
Desktop 的 vendor match。CLI/Desktop 也不得硬编码 default model/base URL/family/env 名。

## 7. Explicit OpenAI adapter option

Agnes 的出站 thinking extension 不按 `model.starts_with("agnes-")` 推断。
`agent::llm` 根据 catalog entry 解析窄的显式 option，例如：

```rust
pub enum OpenAiThinkingExtension {
    None,
    ChatTemplateKwargs,
}
```

OpenAI adapter 把 option 交给 normalize；normalize 结合 canonical `ThinkingLevel` 生成
JSON。normalize 不读取 `ProviderId`，option 不进入 `ModelRequest` 或 Session Item Log。
当前不建立通用 `WireProfile` / compatibility registry。

## 8. Host responsibilities

### CLI

- 持有 `PersistedSettings` schema、version migration 和 JSON IO；
- 把 persisted LLM 字段映射成 `LlmConfigLayer`；
- 从 flags 构造 host layer，调用 env reader 和统一 merge；
- interactive 模式仅在 resolved key 为空时读取隐藏 stdin；one-shot 直接报错；
- `/settings` Provider cycle 原子刷新 Provider current、Model current/values、Base URL
  current、runtime store，并清空旧 API key；
- `sync_to_runtime` 不得让旧 Model/Base URL projection 覆盖刷新结果。

### Desktop

- 持有自己的 settings schema/version/JSON IO，并映射为同一 `LlmConfigLayer`；
- `dotenvy` 注入完成后构造 environment layer；
- 显式 launch/UI input 构造 host layer；没有输入时为空；
- 缺 key 返回可展示错误，不读取 stdin；
- 仅存在 `AGNES_API_KEY` 不自动切换 provider。

### Common prohibitions

- agent runtime 不读取 settings 文件；
- host 不维护 concrete vendor table；
- `AgentConfig` 装配后不再次应用 environment/host override；
- host 不决定 normalize wire JSON 字段。

## 9. Acceptance tests

每个测试注释必须说明场景、预期和不变量。最低覆盖：

- DeepSeek settings + Agnes environment/host 得到完整 Agnes bundle；
- 反向切换也不泄漏 endpoint/credential；
- settings < env < host 的同 provider model/base URL/key precedence；
- 两个 provider key env 同时存在时只取 final provider 对应 key；
- CLI/Desktop 对同一 layer 输入得到相同 `ResolvedProviderConfig`；
- settings/env/host 显式空白 model/base URL 在 layer construction 失败；
- Agnes on/off 与 DeepSeek no-extension JSON；全仓无 model-prefix wire 判定；
- `/settings` 使用 production-shaped full catalog 验证 entries 与 runtime store 同步；
- `AgentConfig` 只有一个 provider fact；`agent-core` 不含 concrete vendor catalog。

## 10. Non-goals

- 不新增 provider、model 或 adapter family；
- 不实现 OpenAI Responses、Anthropic Messages HTTP 或多 provider routing；
- 不修改 settings version 2 持久化形状；
- 不设计 per-provider credential vault、共享 settings crate或第五个配置层；
- 不让 Desktop 读取 stdin；
- 不把 adapter option 放入 `ModelRequest`、Session Item Log 或通用 compatibility registry；
- 不改变 Desktop protocol、Session、Turn/Step、permission 或 scheduler。

## 11. Validation

实现验收按 [`llm-provider-config-fix.md`](llm-provider-config-fix.md) 执行 focused tests、
workspace gate、独立 Standards/Spec review 和用户 diff review。测试/检查结果是 scoped
evidence；若工具链 MSRV 阻塞，必须记录当前 `rustc --version` 和可复现错误，不能把
环境失败写成代码通过。
