# Agnes AI Provider 集成

> **状态：** 当前设计（2026-08-26 已实现并通过门禁，待用户 diff review）
> **外部文档：** [Agnes AI 概述](https://www.agnes-ai.cn/zh-Hans/docs/overview)

## 概述

MoonTide 通过 **`agent::llm::catalog`** 接入 Agnes AI，与 DeepSeek 并列可选。两者共用
`AdapterFamily::OpenAiChatCompletions` 与 `OpenAiChatAdapter`。concrete catalog 固定
provider-owned model slice、default endpoint、credential env 名、family 和解析后的
adapter option；`agent-core` 不拥有 vendor table。

厂商 JSON 差异的 encode/decode 仍归 **`normalize/openai_chat/`**。出站 thinking 行为由
`ResolvedProviderConfig` 显式传入的 `OpenAiThinkingExtension` 选择，不再从 model id
前缀推断；入站 `reasoning_content` 仍映射为 canonical `ThinkingPart`。

## Catalog 对照

| 项目 | DeepSeek | Agnes |
|------|----------|-------|
| `ProviderId` | `deepseek`（默认） | `agnes` |
| Base URL | `https://api.deepseek.com` | `https://api.agnes-ai.cn/v1` |
| 默认 model | `deepseek-chat` | `agnes-2.5-flash` |
| API Key env | `DEEPSEEK_API_KEY` | `AGNES_API_KEY` |
| Adapter family | `OpenAiChatCompletions` | `OpenAiChatCompletions` |
| OpenAI thinking extension | `None` | `ChatTemplateKwargs` |

### Thinking 映射（显式 resolved option）

| 方向 | DeepSeek | Agnes |
|------|----------|-------|
| 出站（`ModelRequest` → JSON） | `OpenAiThinkingExtension::None`，不附加 Agnes 字段 | `ChatTemplateKwargs` 且 thinking 开启时写 `chat_template_kwargs.enable_thinking` |
| 入站（SSE → `ModelStreamEvent`） | `reasoning_content` → `ThinkingPart` | 同上（OpenAI 族字段） |

`agent::llm` 从 Agnes catalog entry 解析 option；OpenAI adapter 把 option 传给
[`crates/agent-core/src/llm/normalize/openai_chat/thinking.rs`](../../agent-core/src/llm/normalize/openai_chat/thinking.rs)。normalize 不读取 `ProviderId`。

### Agnes Agent 模型 catalog

| Model ID | 说明 |
|----------|------|
| `agnes-2.5-flash` | Agent/编码/工具调用（默认） |
| `agnes-2.0-flash` | 上一代兼容 |
| `agnes-2.5-pro` | 强推理（付费，需账户开通） |

## 使用

### CLI

```bash
export AGNES_API_KEY=sk-...
moontide --provider agnes --model agnes-2.5-flash --prompt "hello"
```

Settings（`/settings`）可切换 Provider 与 Model；切换 Provider 会原子刷新 Provider、
Model current/values、Base URL current 与 runtime store，并清空旧 API key（需重新输入
或依赖环境变量）。显式空白 model/base URL 是配置错误。

### Desktop

Desktop 自己拥有 settings schema/JSON IO，把 `<cwd>/.moontide/settings.json` 转为
Layer 2；环境变量构成 Layer 3；无显式 Desktop override 时 Layer 4 为空。三者调用同一
**`agent::llm` provider-scoped merge**。缺 credential 时启动失败，不读 stdin。

```bash
export MOONTIDE_PROVIDER=agnes
export AGNES_API_KEY=sk-...
# 或在 settings.json 中持久化 provider + api_key
```

**注意：** 仅设置 `AGNES_API_KEY` **不会**自动切换 provider；provider 由 settings / `MOONTIDE_PROVIDER` / 显式 UI 切换决定。

### settings.json（version 2）

```json
{
  "version": 2,
  "provider": "agnes",
  "model": "agnes-2.5-flash",
  "base_url": "https://api.agnes-ai.cn/v1",
  "api_key": "...",
  "approval_policy": "always",
  "trace_mode": "off",
  "max_tokens": 4096,
  "max_steps": 8,
  "persistence": { "session": "items", "diagnostic": "off" }
}
```

version 1 文件缺 `provider` 时迁移为 `deepseek`。

## 架构

### 分层职责

| 层 | 职责 | 不做 |
|----|------|------|
| **`agent::llm::catalog`** | concrete `ProviderId`、provider-owned models、defaults、env 名、adapter option | settings IO、wire JSON encode |
| **`normalize/openai_chat`** | `ModelRequest` + explicit options ↔ OpenAI Chat Completions JSON；SSE decode | vendor identity、endpoint 解析 |
| **`normalize/anthropic_messages`** | Anthropic Messages 映射（后置） | — |
| **`adapter/{family}`** | HTTP + SSE；调用 `encode_request` | preset 表、API key |
| **`agent::llm`** | concrete catalog、provider-scoped merge、env registry、`ResolvedProviderConfig` | 读 CLI/Desktop settings 文件 |
| **CLI / Desktop** | 各自拥有 settings schema/IO、构造 `LlmConfigLayer`、调 merge | vendor table、wire policy |

### 调用链

```text
CLI / Desktop
  → host-owned settings parser → LlmConfigLayer
  → read_llm_env + host layer
  → agent::llm::merge_startup_llm_config
  → ResolvedProviderConfig { provider_id, model, family, base_url, api_key, openai_chat }
  → AgentConfig { provider: ResolvedProviderConfig, ... }
  → bootstrap → AdapterConfig::OpenAiChat { base_url, api_key, options: openai_chat }
  → build_provider(adapter_config)
  → OpenAiChatAdapter.stream(ModelRequest { thinking_level, model, messages, ... })
  → normalize/openai_chat::encode_request(&ModelRequest, openai_chat)
       └── thinking.rs: explicit extension → Agnes 出站字段
  → POST {base_url}/chat/completions
  → normalize/openai_chat/stream + thinking: SSE → ModelStreamEvent
```

### 实现位置

| 模块 | 路径 |
|------|------|
| Catalog / startup merge | [`crates/agent/src/llm/`](../../agent/src/llm/) |
| OpenAI normalize | [`crates/agent-core/src/llm/normalize/openai_chat/`](../../agent-core/src/llm/normalize/openai_chat/) |
| OpenAI adapter | [`crates/agent-core/src/llm/adapter/openai_chat/mod.rs`](../../agent-core/src/llm/adapter/openai_chat/mod.rs) |
| Agent re-export / bootstrap | [`crates/agent/src/llm/`](../../agent/src/llm/)、[`bootstrap.rs`](../../agent/src/bootstrap.rs) |
| 启动分层计划 | [`startup-config-layering.md`](startup-config-layering.md) |
| CLI | [`crates/cli/src/config.rs`](../../cli/src/config.rs)、[`settings.rs`](../../cli/src/settings.rs) |
| Desktop | [`crates/moontide-desktop/src-tauri/src/bootstrap.rs`](../../moontide-desktop/src-tauri/src/bootstrap.rs) |

### 设计取舍

早期参考方案在 `Model` 上同时绑定 `api`、`compat`、`thinkingFormat`。MoonTide 修正为：

- **catalog** 固定 provider-owned model/default endpoint/env 名/family，并解析窄的 adapter option
- **thinking wire encode** 由 **normalize 按显式 adapter option** 处理，不按 model/vendor 字符串推断
- 内部 canonical 状态已是 `Message` / `ThinkingLevel`；wire 差异是 encode/decode 细节

## 迁移状态

| 步骤 | 内容 | 状态 |
|------|------|------|
| 1 | R7 初版接入 Agnes 与 OpenAI normalize | 完成（历史） |
| 2 | concrete catalog 从 core 移至 `agent::llm`，消除 production catalog panic | 完成 |
| 3 | 收敛为单一 `ResolvedProviderConfig` 与 provider-scoped merge | 完成 |
| 4 | 用显式 `OpenAiThinkingExtension` 取代 model-prefix 推断 | 完成 |
| 5 | host-owned settings parser、CLI projection 刷新与 blank validation | 完成 |
| 6 | focused tests、`just check` 与独立 review | 完成（2026-08-26） |

## 不在本批次

- Agnes Image / Video API
- OpenAI Responses / Anthropic Messages 实装（仅有 stub adapter）
- 多 provider 并行路由
- 通用 `WireProfile` / compatibility registry（刻意不做；只保留当前 OpenAI thinking consumer）
