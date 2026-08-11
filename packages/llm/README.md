# @moontide/llm

本包负责 **model 注册表**、**Provider Preset**、routing 与 `runLLM`；厂商 **API 适配层** 在 `src/adapters/`。Spec：[`docs/spec/llm-provider.md`](../../docs/spec/llm-provider.md) · 输入三参数 [`llm-input.md`](../../docs/spec/llm-input.md)。

## 四层包边界

| 包 | 唯一回答的问题 |
|----|----------------|
| **`@moontide/llm`（本包）** | 一次标准化 `LLMRequest` 应通过哪个 model / Provider route 执行，以及如何适配厂商 API 参数？ |
| `@moontide/agent-core` | 一个 LLM loop 下一步怎么运行，turn、tool 调用与固定 `RunEvent` 协议如何推进？ |
| `@moontide/agent` | 一个 MoonTide `AgentSession` 如何构建，Session、context preset、LLM、tools 与 hooks 如何装配？ |
| `@moontide/agent-cli` | 如何把 `@moontide/agent` 运行成 terminal REPL 产品？ |

运行调用链：`agent-cli → agent → agent-core → 注入的 StreamFn → agent stream-fn → llm adapter`。其中产品级「应该选哪个模型」策略来自 Agent preset / config；本包负责把该策略解析为 route，并按 route 执行请求。`agent-core` 不直接依赖本包。

## 职责

- **Model 注册表**（`MODEL_REGISTRY`）：logical model id → context window、vendor id、compaction 策略
- **Provider Preset**（`PROVIDER_PRESETS`）：官方 API 通道（baseUrl、adapter family、`apiKeyEnv`）
- **Routing**：`resolveRoute` — 从 env / 配置解析当前 model + preset + thinking level
- **runLLM**：统一入口，经 `LLMProvider` port 调 adapter（chat / responses 等）
- **能力声明**：adapter capability lookup（conformance / 文档用）

本包负责「解析 model / Provider route、适配 API、发请求」，**不**决定产品级模型策略，也不组装 Session → `LLMRequest`（那是 `@moontide/context-composer` 的 **compile**）。

## 不做什么（硬边界）

| 禁止 | 说明 |
|------|------|
| `composeContext` / Session Item | 见 `@moontide/context-composer` · `@moontide/session` |
| `agent/` · Harness | 见 `@moontide/agent`；[`architecture-boundaries`](../../tests/conformance/architecture-boundaries.test.ts) 要求 `@moontide/llm` 零 agent import |
| `runLoop` / RunEvent | 见 `@moontide/agent-core` |
| 终端 stderr / REPL | 无终端 IO |

## 谁应该用

| 调用方 | 用途 |
|--------|------|
| `@moontide/agent` | Harness `stream-fn` → `runLLM` |
| `@moontide/context-composer` | token 估算、model profile、compaction policy |
| `@moontide/agent-cli` | `resolveRoute`、配置 fatal（经本包 export） |
| 测试 | `setLLMProvider()` 注入 mock，不触网 |

## 对外 API

### package.json exports

| Subpath | 说明 |
|---------|------|
| `@moontide/llm` | 主入口（routing、runLLM、registry、presets） |
| `@moontide/llm/protocol` | LLM request/response 协议类型 |
| `@moontide/llm/models` | model 注册表与 profile 解析 |

### 稳定符号（根 export，节选）

| 类别 | 符号 |
|------|------|
| 调用 | `runLLM`, `RunLLMInput`, `LLMCallOutcome`, `LLMCallRecord` |
| Provider port | `getLLMProvider`, `setLLMProvider`, `LLMProvider`, `LLMCallOptions` |
| Routing | `resolveRoute`, `toRoutingDecision`, `ResolvedRoute`, `RoutingDecision` |
| Thinking | `resolveThinkingLevel`, `ThinkingLevel`, `explicitThinkingLevelFromEnv` |
| Registry | `MODEL_REGISTRY`, `lookupModelEntry`, `DEFAULT_CONTEXT_WINDOW` |
| Preset | `PROVIDER_PRESETS`, `getProviderPreset`, `ProviderPreset`, `AdapterFamily` |
| Compaction | `defaultCompactionPolicy`, `resolveCompactionPolicy`, `resolveModelProfile` |
| 能力 | `findCapabilityDeclaration`, `lookupCapabilityStatus` |
| 工具 | `extractText`, `isAbortError`, stop reason mappers |

完整列表见 [`src/index.ts`](src/index.ts)。

## 最小用法

### Mock Provider（单测 / L1 eval）

```ts
import { setLLMProvider, resolveRoute, runLLM } from "@moontide/llm";

setLLMProvider({
  async chat() {
    return { message: { role: "assistant", content: "ok" }, usage: { input: 1, output: 1 } };
  },
});

const route = resolveRoute(); // 需 DEEPSEEK_API_KEY 或 ANTHROPIC_API_KEY 等（或测试里 preset env）
await runLLM({ system: "…", messages: [], tools: [], route });
```

### 前提

- API key 经 workspace 根 `.env` 或 `MOONTIDE_*` env（CLI 在 `loadBootstrapEnv` 之后可用）
- `MODEL_ID` / 默认 model 见 `llm/models/registry.ts` 与 Spec §9

## 相关文档与验收

| 文档 / 测试 | 内容 |
|-------------|------|
| [`docs/spec/llm-provider.md`](../../docs/spec/llm-provider.md) | Preset、routing、adapter 边界 |
| [`docs/spec/llm-input.md`](../../docs/spec/llm-input.md) | system / messages / tools 三参数 |
| [`docs/notes/llm/edge-local-models.md`](../../docs/notes/llm/edge-local-models.md) | 本地 model catalog（与 cloud registry 区分） |
| [`tests/llm-run-llm.test.ts`](../../tests/llm-run-llm.test.ts) | runLLM 行为 |
| [`tests/conformance/architecture-boundaries.test.ts`](../../tests/conformance/architecture-boundaries.test.ts) | llm 零 agent / composer import |
