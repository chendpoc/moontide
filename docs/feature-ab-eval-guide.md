# Feature A/B Eval 指南

> **Upstream（Pi）：** 本文描述 Pi 仓库的 `packages/evals` + `vitest-evals` 工作流。  
> **MoonTide 实现：** 见 [`docs/spec/harness-eval-1.0.md`](spec/harness-eval-1.0.md) · [`packages/evals/`](../packages/evals/)。

按需、轻量地使用 `packages/evals` 做 agent feature 的 A/B 对比评估。目标不是维护完整 benchmark，而是在每次开发 feature 时，用可审计的数据回答：**开启该 feature 后，agent 能力是否提升、代价是否可接受**。

## 定位

### Pi evals 是什么

Pi evals 是**模型驱动的行为评估**：把真实 `AgentSession` 适配到 [`vitest-evals`](https://github.com/getsentry/vitest-evals)，在隔离的临时目录中运行，并附加原生 session JSONL 等 artifact。

它能：

- 收集 token 用量、耗时、估算成本
- 对比 baseline 与 candidate harness（A/B 或多臂）
- 支持多步工作流（`prompt` → `reload` → `prompt`）
- 用 judge 打分，reporter 输出 pass rate lift 与成本 delta

### 与 `coding-agent/test/suite/` 的区别

| | `test/suite/` | `packages/evals` |
|--|---------------|------------------|
| 模型 | faux provider，无真实 API | 真实模型 + 鉴权 |
| 目标 | CI 回归、确定性 | 端到端能力、A/B 对比 |
| 成本 | 免费、快 | 按 token 计费 |
| 是否进 CI | 是 | 否（本地 / PR 前手动跑） |

两套体系互补，evals 不替代 suite 测试。

### 为什么 repo 没有完整 benchmark

- **阶段**：基础设施（harness、对比 reporter、artifact）刚就绪，case 仍以示范为主（`smoke.eval.ts`、`extensions.eval.ts`）。
- **CI 策略**：完整 A/B 需要真实模型，不适合每次 PR 自动跑。
- **维护成本**：大规模 case 库需要持续更新 judge、应对模型漂移。
- **项目取向**：更鼓励真实 session 数据（见根 `README.md` 与 [`pi-share-hf`](https://github.com/badlogic/pi-share-hf)），而非单一合成 benchmark。

本指南描述的是 **feature-scoped、一次性、可归档** 的 eval，与「永久 benchmark 产品」不是同一类投入。

## 适用场景

适合：

- 开发某 feature 时，对比 baseline vs feature enabled
- 合并前做一次可靠打分与数据分析
- 将 case 定义、rubric、`.eval/` 产物开源或附在 PR 上，供审阅与回放

不适合：

- 替代 CI 单元 / 回归测试
- 维护 100–500 case 的持久 benchmark（除非单独立项）
- 无鉴权、无预算的自动化流水线

## Workflow 概览

每个 feature 一轮 eval，四步固定：

```
1. 定义 harness
   baseline  = feature OFF（或旧实现）
   candidate = feature ON（或新实现）

2. 编写 case（见下文规模建议）
   每个 case 有稳定 id；prompt 具体、可复现

3. 打分
   确定性 judge：工具调用、文件、格式（能写就写）
   LLM judge：answer quality、是否更有价值

4. 运行并归档
   npm run eval -- --provider <p> --model <m> src/<feature>.eval.ts
   保存 .eval/ 或 runs.jsonl，附 PR / 提交 eval-results/
```

### 开发期 vs 合并前

| 阶段 | Case 数 | Repetitions | 目的 |
|------|---------|-------------|------|
| 开发迭代 | 5–10 | 1–2 | 调 harness、judge rubric |
| 合并决策 | **30–50** | **3–5** | 看 pass rate lift、成本 delta |

3–10 个 case 只适合冒烟，**不宜单独作为合并依据**。30–50 × 3 repetitions 在成本与信号质量之间较均衡。

### 成本粗算

```
总 agent 次数 ≈ case 数 × repetitions × 2（baseline + candidate）

30 × 3 × 2 = 180 次
50 × 3 × 2 = 300 次
```

多步 prompt（含 `reload`）按步数倍增。优先增加 **case 多样性**，其次增加 repetitions。

## 构建 Baseline 与 Candidate

Baseline **不会自动生成**，需在 `evalHarnessTable` 中显式声明：

```ts
const table = evalHarnessTable("my-feature-eval", {
  baseline: createPiCodingAgentHarness({ name: "baseline", /* feature OFF */ }),
  candidate: createPiCodingAgentHarness({ name: "with-feature", /* feature ON */ }),
  repetitions: 3,
});
```

原则：

- **只改一个变量**：baseline = 无 feature / 旧行为；candidate = 有 feature / 新行为
- **其余配置一致**：同一模型、同一 `noTools`、同一批 case prompt
- **稳定 `name`**：reporter 按 harness 名分组对比

`createPiCodingAgentHarness` 可调项：

| 选项 | 用途 |
|------|------|
| `name` | 对比报告中的 harness 标识 |
| `model` | 覆盖 runner 默认模型 |
| `noTools` | 工具开关 |
| `transformSystemPrompt` | 改 system prompt（如注入/剥离 skill 文档） |
| `output` | 从 session 提取 JSON-safe 结果供 judge 使用 |

参考实现：`src/extensions.eval.ts`（对比「完整 system prompt」vs「去掉 Guidelines/Docs」）。

## Case 设计

### 规模建议

| 规模 | 用途 |
|------|------|
| 5–10 | 开发期冒烟 |
| **30–50** | **合并前主区间（推荐）** |
| 50–100 | 重要 feature、需对外说明时 |
| 100–500 | 持久 benchmark，非按需 eval |

### 分类配比（约 35–55 个）

| 类型 | 数量 | 目的 |
|------|------|------|
| 该 feature **应明显提升** | 15–20 | 测价值 |
| **不应变差**的原有能力 | 10–15 | 防回归 |
| **不应被误触发** | 5–10 | 防副作用 |
| 边界 / 刁钻 | 5–10 | 测鲁棒性 |

### 任务形态

单轮：

```ts
await run("What's the capital of France? Respond with only the city name.");
```

多轮（含 reload）：

```ts
await run([
  { type: "prompt", content: "Create a Pi extension..." },
  { type: "reload" },
  { type: "prompt", content: "Use the hello tool..." },
]);
```

参数化多 case（推荐）：

```ts
const cases = [
  { id: "should-improve-1", prompt: "...", expectLift: true },
  { id: "no-regression-1", prompt: "...", expectLift: false },
] as const;

it.for(cases)("$id", async ({ prompt }, { run }) => {
  await run(prompt);
});
```

`evalHarnessTable` 用 `input.id`（或 canonical JSON 的 SHA-256）做配对键，保证同一 case、同一 repetition 下 baseline 与 candidate 成对比较。

Case 定义建议进 git（如 `cases/my-feature.json` 或 eval 文件内 `it.for`），与代码一并 review。

## Judge 设计

### 分层策略（推荐）

```
确定性 judge  →  gate（工具、文件、格式必须通过）
LLM judge     →  answer quality、是否更有价值
```

| 任务类型 | 推荐 judge |
|----------|------------|
| 工具是否调用、参数是否正确 | `toolCalls(...)` + 确定性 `createJudge` |
| 文件是否创建、import 规范 | 读 `output` + 正则 / 静态检查 |
| 开放问答、摘要、解释质量 | `FactualityJudge` 或自定义 LLM judge（`vitest-evals`） |
| 管道是否通 | 直接 `expect`（如 `smoke.eval.ts`） |

### 确定性 judge 示例

见 `ExtensionAuthoringJudge`（`src/extensions.eval.ts`）：检查扩展源码、import、`toolCalls`、最终 response。

返回 `{ score: 0 | 1, metadata: { rationale } }`；`score >= 1` 计为 pass。

### LLM as judge

- **适合**：answer quality、是否遵循 feature 预期、两版回答孰优
- **注意**：单独配 `judgeHarness`（评判模型可与 agent 模型不同）；低温、便宜模型即可
- **局限**：不能替代工具调用、文件存在等客观检查

`vitest-evals` 提供 `FactualityJudge({ judgeHarness })`、`ctx.runJudge(...)` 等；Pi repo 内尚无 LLM judge 示例，可按 [vitest-evals 文档](https://vitest-evals.sentry.dev/docs) 接入。

### 对比 suite 的阈值

对比型 eval 建议：

```ts
describeEval("...", { harness, judges: [MyJudge], judgeThreshold: null }, ...)
```

`judgeThreshold: null` 表示低分记为**观测**，不直接 fail 测试，便于看 lift 而非二元结论。硬 `expect` 仅用于基础设施不变量。

## 数据分析

Reporter 终端输出与 `summary.ts` 逻辑关注：

| 指标 | 含义 |
|------|------|
| **Pass rate lift** | candidate 通过率 − baseline 通过率（百分点） |
| **Token / 延迟 / Est. cost delta** | 配对均值差（candidate − baseline） |
| **Incomplete observations** | 缺失 score、errored 的 pair，需重跑或剔除 |

### 经验决策阈值（非统计检验）

- lift ≥ +10pp 且成本增幅 &lt; 30% → 倾向合并
- lift 在 ±5pp → 样本不足或 feature 无效，加 repetitions 或改 case
- lift 为正但成本翻倍 → 权衡是否值得

不必追求 p-value；30–50 case × 3–5 repetitions 足以支撑 feature 级决策。

## 可信、可审阅、可回放

每次运行写入 `.eval/<timestamp>_<uuid>/`（见 `scripts/run-evals.mjs`）：

| 产物 | 内容 |
|------|------|
| `runs.jsonl` | 每次 run 的 harness、token、耗时、judge 元数据、artifact 引用 |
| `sessions/` | 原生 Pi session JSONL，完整对话回放 |

可选：

- 将 `.eval/` 或摘要提交到 `eval-results/<feature>-<date>/`
- 用 `recordEvalSourceArtifact` 附加生成源码（见 `extensions.eval.ts`）
- 用 [`pi-share-hf`](https://github.com/badlogic/pi-share-hf) 发布 session 到 Hugging Face

复现三要素：**同一 case 定义 + 同一 harness 配置 + 同一 judge rubric**（均进 git）。

## 骨架模板

```ts
import { describe } from "vitest";
import { createJudge, describeEval } from "vitest-evals";
import { createPiCodingAgentHarness } from "./pi-harness.ts";
import { evalHarnessTable } from "./vitest-evals/harness-table.ts";

const baseline = createPiCodingAgentHarness({ name: "baseline" });
const candidate = createPiCodingAgentHarness({ name: "with-my-feature" });

const cases = [
  { id: "improve-1", prompt: "..." },
  { id: "no-regression-1", prompt: "..." },
] as const;

const QualityJudge = createJudge("QualityJudge", ({ output, toolCalls }) => ({
  score: /* 0 | 1 或连续分 */,
  metadata: { rationale: "..." },
}));

const table = evalHarnessTable("my-feature-eval", {
  baseline,
  candidate,
  repetitions: 3,
});

describe.for(table)("$name rep $repetition", ({ harness }) => {
  describeEval("my-feature", { harness, judges: [QualityJudge], judgeThreshold: null }, (it) => {
    it.for(cases)("$id", async ({ prompt }, { run }) => {
      await run(prompt);
    });
  });
});
```

## 运行命令

```bash
# 仓库根目录
npm run eval -- --provider openai --model gpt-5.6-sol src/my-feature.eval.ts

# 或环境变量
PI_PROVIDER=openai PI_MODEL=gpt-5.6-sol npm run eval -- src/my-feature.eval.ts

# 过滤用例
npm run eval -- -t "improve-1"
```

鉴权走 Pi 常规 `ModelRuntime`（API key 或订阅）。产物目录路径会打印在 stderr：`[eval] artifacts=...`。

## 参考

- 运行与 API：`packages/evals/README.md`
- 示范 A/B：`packages/evals/src/extensions.eval.ts`
- Harness 实现：`packages/evals/src/pi-harness.ts`
- 对比汇总：`packages/evals/src/vitest-evals/summary.ts`
- 方法论：[`skill-eval-harness`](https://github.com/adewale/skill-eval-harness/)、[vitest-evals](https://github.com/getsentry/vitest-evals)
