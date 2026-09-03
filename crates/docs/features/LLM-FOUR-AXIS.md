# LLM 四轴解耦与三协议

> **性质：** Feature Task / 架构对齐文档（用户已确认）
> **状态：** R1–R5 已实现（见 git diff review 后续 fix 批）
> **关联：** [`../archive/plans/llm-provider-config-fix.md`](../archive/plans/llm-provider-config-fix.md) · [`../design/startup-config-layering.md`](../design/startup-config-layering.md) · [`../../agent-core/src/llm/README.md`](../../agent-core/src/llm/README.md) · [`../../agent-core/DESIGN.md`](../../agent-core/DESIGN.md#llm) · [`../../agent/DESIGN.md`](../../agent/DESIGN.md)

## 1. 结论

MoonTide LLM 边界拆成 **四轴 + 两类配置 + 分层 merge**：

| 轴 | Owner | 说明 |
|----|-------|------|
| **Provider** | `agent::llm::catalog` | 厂商身份、凭据 env、default base URL、**default protocol**、supported protocols |
| **Protocol** | `agent-core::llm::AdapterFamily` | Wire 形状：OpenAI Chat / Responses / Anthropic Messages / Google Generative AI |
| **Model** | 字符串 | Catalog 建议；允许自定义 id |
| **Base URL** | Provider 默认 + host override | API root；adapter 追加 path |

**两类配置（必须区分）：**

| 类型 | 含义 | Owner | 是否 merge |
|------|------|-------|------------|
| **协议能力 `ProtocolCapabilities`** | 选定协议后，adapter **已实现**的功能全集（上限） | `agent-core` 每 `AdapterFamily` 静态 | 不 merge；只作校验天花板 |
| **协议特性配置 `ProtocolFeatureConfig`** | 在上述能力内，**开启或关闭**各项特性（开关） | 厂商 default → 用户 profile → CLI/env | **分层 override** |

**Provider 侧：** 每个 `(ProviderId, Protocol)` 一份 **`ProviderProtocolProfileDefault`**（默认走哪条协议、默认开启哪些特性、wire compat 默认值）。

**用户侧：** settings / Custom provider 可提交 **`UserProtocolProfileOverride`**（局部 patch）。

**合并（特性配置）：**

```text
resolved.features = clamp(
  merge(defaultProfile.features, userProfile.features, hostProfile.features),
  protocolCapabilities,
  vendorFeatureCeiling,
)
```

等价于用户描述的 `Object.assign(default, user, cli/env)`，但 **后层覆盖前层** 且 **不能开启能力天花板之外的特性**。

**运行时三层（endpoint / 单次调用）：**

1. **L1 `ProviderEntry`** — catalog（含 `default_protocol`、`protocol_profile_defaults[]`）
2. **L2 `ResolvedProviderConfig`** — merge 后的 provider 实例（含 `ResolvedProtocolProfile`）
3. **L3 `LlmCallConfig`** — 每次 Turn/Step 快照

**连续性：** Session Item Log 仍是 resume/replay **唯一事实源**。Optimized 路径（如 `previous_response_id`）须同时满足：协议能力 ✓、厂商 ceiling ✓、**特性开关 enabled** ✓。

## 2. 用户问题

现有 [`LlmModel`](../../agent/src/llm/catalog.rs) 把 `family`、`base_url`、`openai_chat` 绑在 model 上；宿主不能选 protocol；`ResolvedProviderConfig` 无法表达 Anthropic / Responses options。DeepSeek、Agnes 文档已支持 Responses API，不应假设「只有 Chat」。

本 Feature 要回答：

> 如何在保持 Session Item Log 为事实源的前提下，让 Provider / Protocol / Model / Base URL 独立配置，并对各厂家分别适配 wire 与连续性能力？

## 3. 当前状态与目标状态

### 3.1 当前

- `AdapterFamily`：`OpenAiChatCompletions` | `AnthropicMessages`（Anthropic adapter 为 stub）
- Catalog：DeepSeek、Agnes；均默认 Chat Completions
- `ModelRequestConfig`：仅 model / max_tokens / thinking / session_id
- Protocol 由 catalog model 隐式决定，settings 不可选

### 3.2 目标

- `AdapterFamily` 增加 `OpenAiResponses`；内置协议 adapter 实装；**Gemini 新增 `GoogleGenerativeAi` 族（R5）**
- Catalog 增加 OpenAI、Anthropic、**Google**；**Custom provider** 由宿主配置加载；DeepSeek/Agnes 默认 Responses
- `ProviderProtocolProfile`  per (provider, protocol)，**含可声明的 wire/transport/compat 配置**
- `LlmCallConfig` 含 protocol、profile、endpoint、options、continuity_hint
- settings/env：`protocol` 字段（provider-scoped merge）

## 4. 范围与非目标

### 4.1 在范围内

- **Google Gemini（`ProviderId::Google`）**：catalog 内置；wire 族 **`GoogleGenerativeAi`**（Pi 称 `google-generative-ai`）；实现批次 **R5**（R1–R4 先落类型与 catalog 占位）。
- **Custom provider**：用户/项目声明的 endpoint，**必须映射到已有 `AdapterFamily`**（不能发明新 wire）；见 §7.2。
- **`ProviderProtocolProfile` 声明配置**：连续性能力位 + **wire compat / transport / 默认 options**（非仅 bool 能力表）。

### 4.2 非目标

- 多 provider 同 Turn 并行路由
- Responses WebSocket / Realtime（profile **可声明** `prefer_websocket`，实现后置）
- `response_id` sidecar 持久化为新 SessionItem 类型（R2 用 turn 内内存；落盘另批）
- **通用 WireProfile 框架**（见 §13）
- settings 主版本 bump（除非加法字段不够）

## 5. 所有权

| 实体 | Owner | 不负责 |
|------|-------|--------|
| MoonTide 协议、`LlmCallConfig`、`AdapterFamily` | `agent-core::llm` | ProviderId、catalog、settings IO |
| `ProviderEntry`、`ProviderProtocolProfile`、merge | `agent::llm` | HTTP、读 settings 文件 |
| settings schema / JSON IO | CLI / Desktop | vendor 表、wire encode |
| Session 多轮事实 | `session` Item Log | provider response 存储 |
| Canonical materialize | `context` | adapter、凭据 |
| Optimized continuity sidecar | `loop`（R2） | 写入 model-visible Session Item |

## 6. 协议能力 vs Profile 配置 vs Merge

### 6.1 协议能力（Capabilities）— 不 merge

`agent-core` 为每个 `AdapterFamily` 声明 **已实现的功能全集**。选定协议后，MoonTide **尽可能支持**该协议在 adapter 中的全部能力；Capabilities 是文档化 + 校验用的上限，不是用户配置文件。

```rust
/// 静态；随 adapter 实现扩展（R2 增 Responses 特性，R5 增 Gemini）
pub struct ProtocolCapabilities {
    pub family: AdapterFamily,
    pub features: ProtocolFeatureSet,
}

bitflags::bitflags! {
    pub struct ProtocolFeatureSet: u64 {
        const STREAMING            = 1 << 0;
        const TOOLS                = 1 << 1;
        const THINKING             = 1 << 2;
        const VISION               = 1 << 3;
        // Responses 族
        const RESPONSES_STORE              = 1 << 8;
        const RESPONSES_PREVIOUS_ID        = 1 << 9;
        const RESPONSES_CONVERSATION       = 1 << 10;
        const RESPONSES_WEBSOCKET          = 1 << 11;
        // Anthropic 族
        const ANTHROPIC_PROMPT_CACHE       = 1 << 16;
        // ...
    }
}
```

### 6.2 协议特性配置（Feature toggles）— 分层 merge

在 Capabilities 之内，用 **开关** 决定本次是否启用某特性。结构对每族相同，但无效组合在 merge 时 **clamp 掉**（例如 DeepSeek 上用户写 `store: true` → 忽略或 merge 报错，R1 定稿）。

```rust
pub struct ProtocolFeatureConfig {
    pub enabled: ProtocolFeatureSet,
}

/// 厂商 catalog 默认（每个 provider × protocol 一条）
pub struct ProviderProtocolProfileDefault {
    pub provider_id: ProviderId,
    pub protocol: AdapterFamily,
    pub features: ProtocolFeatureConfig,
    pub wire: WireProfileConfig,
    pub default_options: AdapterOptions,
    pub vendor_ceiling: ProtocolFeatureSet, // 该厂商 API 实际支持的最大集合（≤ protocol capabilities）
}

/// settings / custom_providers 内可选；仅写需要改的字段
pub struct UserProtocolProfileOverride {
    pub protocol: Option<AdapterFamily>,
    pub features: Option<ProtocolFeatureConfig>,
    pub wire: Option<WireProfilePatch>,
}

/// CLI flags + env（`LlmConfigLayer` 扩展）
pub struct HostProtocolProfileOverride {
    pub protocol: Option<AdapterFamily>,
    pub features: Option<ProtocolFeatureConfig>,
}

/// merge 产物；进入 ResolvedProviderConfig / LlmCallConfig
pub struct ResolvedProtocolProfile {
    pub protocol: AdapterFamily,
    pub capabilities: ProtocolCapabilities,
    pub features: ProtocolFeatureConfig,
    pub wire: WireProfileConfig,
    pub options: AdapterOptions,
}
```

### 6.3 Merge 顺序与 provider-scoped 规则

**Endpoint 四轴**（已有 [startup-config-layering](../design/startup-config-layering.md)）：

```text
catalog (provider, model, base_url, default protocol)
  ← settings (同 provider 才生效)
  ← environment
  ← host (CLI)
```

**协议特性 Profile**（本 Feature 新增，与四轴 **正交**，但 `protocol` 字段 provider-scoped）：

```text
ProviderProtocolProfileDefault     // catalog：厂商对该协议的 default config
  ← UserProtocolProfileOverride    // settings.profile 或 custom_providers[].profile
  ← HostProtocolProfileOverride    // env / CLI -c profile.*
  → clamp(capabilities, vendor_ceiling)
  → ResolvedProtocolProfile
```

伪代码：

```javascript
// 后层覆盖前层；Rust 侧为 typed merge + clamp，不是无校验 assign
finalProfile = clampFeatures(
  { ...defaultProfile, ...userProfile, ...hostProfile },
  protocolCapabilities[finalProtocol],
  vendorCeiling[finalProvider][finalProtocol],
);
```

**`ProviderEntry.default_protocol`**：未指定 protocol 时的默认值；用户 override 可改 protocol，但必须在 `supported_protocols` 内，且切换后 **换用该 protocol 下的 profile default 链**（不与旧 protocol 的 feature 开关混用）。

### 6.4 内核与运行时类型

```rust
pub enum AdapterFamily {
    OpenAiChatCompletions,
    OpenAiResponses,
    AnthropicMessages,
    GoogleGenerativeAi,
}

pub struct LlmCallConfig {
    pub protocol: AdapterFamily,
    pub profile: ResolvedProtocolProfile,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
    pub max_tokens: u32,
    pub thinking_level: Option<ThinkingLevel>,
    pub session_id: Option<String>,
    pub continuity_hint: ContinuityHint,
}
```

`TurnInput.config` 类型由 `ModelRequestConfig` 改为 `LlmCallConfig`。`ModelRequest` 仍不含 secret。

### 6.5 组合根 `agent`

```rust
pub struct ProviderEntry {
    pub default_protocol: AdapterFamily,
    pub supported_protocols: &'static [AdapterFamily],
    pub profile_defaults: &'static [ProviderProtocolProfileDefault],
    // api_key_env, default_base_url, models ...
}

pub struct ResolvedProviderConfig {
    pub provider_id: ProviderId,
    pub protocol: AdapterFamily,
    pub profile: ResolvedProtocolProfile,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
}
```

### 6.6 厂商 default 示例（特性开关）

| Provider | default_protocol | Responses: store | Responses: previous_id | wire 备注 |
|----------|-------------------|------------------|------------------------|-----------|
| OpenAI | Responses | default **on** | default **on** | 标准 OpenAI decode |
| DeepSeek | Responses | **off**（API 不支持） | **off** | `reasoning_text.delta` |
| Agnes | Responses | off（待验证） | off | `output_items` 路径 |
| DeepSeek | Chat | — | — | `ChatTemplateKwargs` N/A |

Canonical materialize 始终可用；Optimized 路径需 `RESPONSES_PREVIOUS_ID` 在 **capabilities ∩ vendor_ceiling ∩ enabled** 内。

### 6.7 `WireProfileConfig`（profile 的 wire 子配置）

挂在 `ProviderProtocolProfileDefault.wire` / merge 后的 `ResolvedProtocolProfile.wire`。typed 字段，不是任意 JSON 规则引擎（§12）。

```rust
pub struct WireProfileConfig {
    pub encode: WireEncodeConfig,
    pub decode: WireDecodeConfig,
    pub http: WireHttpConfig,
}
```

`UserProtocolProfileOverride.wire` 只允许 **`WireProfilePatch`**（部分字段 `Option`），merge 进 default。

**维护规则：** 新 OpenAI 系网关 → 加 catalog **`ProviderProtocolProfileDefault` 行** + 可选 user template；新 **协议** → 扩 `ProtocolCapabilities` + 新 adapter 目录。

## 7. Catalog 初值

| Provider | default_protocol | supported | default_base_url | 备注 |
|----------|------------------|-----------|------------------|------|
| DeepSeek | Responses | Responses, Chat | `https://api.deepseek.com` | default model 切 Responses id（如 `deepseek-v4-flash`）；Chat 保留 `deepseek-chat` 建议 |
| Agnes | Responses | Responses, Chat, Messages | `https://api.agnes-ai.cn/v1` | 同 model id 跨协议 |
| OpenAI | Responses | Responses, Chat | `https://api.openai.com/v1` | |
| Anthropic | Messages | Messages | `https://api.anthropic.com` | |
| Google | GoogleGenerativeAi | GenerativeAi only | `https://generativelanguage.googleapis.com/v1beta` | `GOOGLE_API_KEY` / `GEMINI_API_KEY`；adapter R5 |

### 7.2 Custom provider

用户/项目级声明，**不扩展 wire 协议**，只扩展 endpoint + 凭据 + 有限 compat patch：

```json
{
  "provider": "my-proxy",
  "protocol": "openai-responses",
  "base_url": "https://llm.example.com/v1",
  "profile": {
    "features": {
      "responses_store": false,
      "responses_previous_id": true
    },
    "wire": {
      "decode": { "output_text_path": "output_items" }
    }
  },
  "custom_providers": {
    "my-proxy": {
      "display_name": "My OpenAI Proxy",
      "protocol": "openai-responses",
      "base_url": "https://llm.example.com/v1",
      "api_key_env": "MY_PROXY_API_KEY",
      "profile_template": "openai-responses",
      "profile": {
        "wire": { "decode": { "output_text_path": "output_items" } }
      }
    }
  }
}
```

- **`profile_template`**：builtin `(provider, protocol)` 的 `ProviderProtocolProfileDefault` 拷贝起点。
- 顶层 **`profile`**：当前选中 provider 的 `UserProtocolProfileOverride`（与 model/base_url 同级 persist）。
- **`profile_template` + `profile`**：Custom 声明 + 用户 override，merge 顺序不变。
- **`ProviderId`**：built-in 用 enum；Custom 用 **stable slug**（settings 里的 key），运行时解析为 `ProviderId::Custom(Cow<str>)` 或等价新类型（R1 定稿）。
- CLI/Desktop：`provider` 可选 built-in 或 custom slug；merge 规则与 built-in 相同（provider-scoped）。
- 安全：Custom 定义放在 **用户级** 或 **受信项目 settings**（参考 Codex：项目 config 不可 hijack provider）；具体边界 R4 与 Desktop/CLI 对齐。

## 8. 数据流

```text
ProtocolCapabilities[family]          // 静态上限
ProviderProtocolProfileDefault        // catalog 厂商 default
        │
        ├─ merge ← UserProtocolProfileOverride (settings.profile)
        ├─ merge ← HostProtocolProfileOverride (env / CLI)
        └─ clamp(vendor_ceiling) → ResolvedProtocolProfile
                │
Parallel: merge_startup_llm_config(provider, model, base_url, protocol, api_key)
                │
                └─ ResolvedProviderConfig (L2)
                        → bootstrap → LLMProvider
                        → Agent::turn → LlmCallConfig (L3)
```

Session Item Log → materialize → compile 始终执行；adapter 读 `LlmCallConfig.profile.features.enabled` 决定是否走 Optimized 路径。

## 9. 宿主

- **CLI** settings v2：`protocol`（可选）、**`profile`**（可选，`UserProtocolProfileOverride`）；`/settings` 增加 Protocol / Profile entries
- **Desktop** settings v3：同上；`#[serde(default)]`
- Env：`MOONTIDE_PROTOCOL`；特性开关 env 命名 R1 定稿（如 `MOONTIDE_RESPONSES_STORE=0`）

Provider 切换时原子刷新 model、base_url、protocol、**profile default 链**、credential。

## 10. 实现批次

| 批 | 内容 |
|----|------|
| **R1** | `ProtocolCapabilities` + `ProviderProtocolProfileDefault` + merge/clamp + `LlmCallConfig` + settings `profile` 字段 |
| **R2** | Responses adapter；Canonical + OpenAI optimized path；DeepSeek/Agnes wiremock |
| **R3** | Anthropic Messages 真实 adapter（替换 stub） |
| **R4** | CLI/Desktop protocol + custom provider 解析；CONTEXT 收尾 |
| **R5** | `GoogleGenerativeAi` adapter + Gemini catalog |

验证：`cargo test -p agent-core -p agent -p cli -p moontide-desktop` → `just check`。

## 11. 停止条件

- settings 主版本或 Session Item Log 持久化形状必须变 → 暂停用户确认
- thinking 必须进 `ModelRequest` 或 Session Item → 暂停（应留 adapter options）
- Desktop 必须整页 LLM settings UI 才能验收 → 先 JSON/env

## 12. 什么是「通用 WireProfile」（刻意不做）

MoonTide 在 [provider-config 修复](../archive/plans/llm-provider-config-fix.md) 与 [Agnes 集成](../design/agnes-provider-integration.md) 中**明确拒绝**的是一层 **与 AdapterFamily 平行的、可插拔规则引擎**：

| 通用 WireProfile 规则引擎（不做） | **`ProtocolCapabilities` + 分层 Profile merge**（做） |
| 单一 JSON 描述所有 wire 形状 | 按 **`AdapterFamily`** 分 adapter；**厂商维护 profile 表** |
| 运行时动态字段映射 | `default ← user ← host` + **clamp** |
| 「加 compat 键接新厂商」 | 新网关 = **新 catalog profile 行** 或 Custom + template |

历史草稿里曾出现 `WireProfile` / `ThinkingWirePolicy` 名字，R8 已改为 **family-specific `AdapterConfig`**（见 [`agent-core/DESIGN.md`](../../agent-core/DESIGN.md#llm) 与 [`PROGRESS.md`](../../../.agents/skills/moontide-kernel-plan/PROGRESS.md)）。

**对照：**

- **Pi** `compat`：provider/model 级 **声明式** 开关，仍绑定在 `api: openai-completions` 等固定 handler 上 → 接近我们的 `WireProfileConfig`。
- **OpenCode** `package`：选 npm 运行时包 → 接近我们的 `AdapterFamily`。
- **Codex** 仅 `wire_api = responses`：无通用 registry，只有 provider 块配置。

结论：**协议能力**在 adapter 层尽量做全；**厂商 default profile** 与 **用户 profile override** 用 typed merge；不是复活无边界通用 WireProfile。

## 13. 参考

- [OpenAI Migrate to Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [DeepSeek Responses API](https://api-docs.deepseek.com/zh-cn/guides/responses_api)
- [Agnes 2.5 Flash](https://www.agnes-ai.cn/zh-Hans/docs/agnes-25-flash)
- Pi Agent `api` 字段：[`models.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md)
- OpenCode provider `package`： [Providers](https://opencode.ai/docs/providers/)
- Codex CLI `wire_api = responses`： [config reference](https://developers.openai.com/codex/config-reference)
