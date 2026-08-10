# Harness Eval Contract-First 重构计划

> **文档性质：** notes（重构计划，非实现 Spec、非当前实现状态）
> **状态：** 2026-08 讨论稿 · 等当前 eval / LLM adapter 在途改动稳定后执行
> **设计依据：** [`agent-eval-task-taxonomy.md`](agent-eval-task-taxonomy.md)
> **现行 Spec：** [`harness-eval-1.0.md`](../spec/harness-eval-1.0.md)
> **执行规则：** 实现阶段遵守 [`AGENTS.md`](../../AGENTS.md)，源码变更后运行 `pnpm run check`

## 1. 交付目标

把 `@moontide/evals` 从“按任务内容分桶、以结果 judge 为中心”重构为“以 Harness contract 为主轴、workload 为抽样维度”的评测系统。

重构后，一条 eval 必须能回答三个不同问题：

1. **Request：** MoonTide 最终生成并路由了什么语义请求？
2. **Trace：** Harness 是否按约定执行 tool loop、state transition、constraint 和 recovery？
3. **Outcome：** 用户目标是否达成？

三层证据独立记录、独立判分。`tool_called` 不再代表工具产生正向价值；workload category 不再代表 Harness contract。

## 2. 当前事实源与边界

### 2.1 事实源

| 事实 | Owner | Eval 读取方式 |
|------|-------|---------------|
| 最终语义 LLM 请求 | Context Composer / `LLMRequest` 调用方 | `LLMCallRecord.request` 的 eval-only observation |
| Provider route | `resolveRoute` / LLM pipeline | `LLMCallRecord.routing` / manifest |
| Provider wire 映射 | `packages/llm/src/adapters/*` | adapter contract test；不写入 Session |
| Run 时序与工具执行 | `@moontide/agent-core` RunEvent protocol | subscribe / 收集 RunEvent；不新建第二套事件协议 |
| 持久事实与结果 | Session Item Log / artifact / workspace | 现有 session、file、artifact grader |
| Eval 配置与 intervention | `@moontide/evals` manifest | `manifest.json` |

### 2.2 分层约束

- Agent Core 不认识 DeepSeek Responses API 字段；
- 跨 provider 的语义能力才进入 `LLMRequest` / RunConfig；
- provider 专有字段与兼容状态留在 adapter 层；
- raw wire request 只进入 adapter unit test，避免 API key、用户输入或 provider 私有字段扩散到运行日志；
- RunEvent 是运行观测协议，Session Item Log 是持久事实源，eval 不反向写业务状态；
- suite/schema 是声明层，grader/collector 是实现层，遵守 spec / impl split。

## 3. 当前实现缺口

| 位置 | 当前形状 | 缺口 |
|------|----------|------|
| [`types.ts`](../../packages/evals/src/types.ts) | `category` + `featureSurface` + `gradingMode` | workload、Harness contract、API profile 和 oracle 混在一个 case 中 |
| [`ExpectedCheck`](../../packages/evals/src/types.ts) | reply / file / tool count / work_mem | 缺 request contract、tool args/order、tool-not-called、result→next-request、stop/error 等检查 |
| [`protocol-checks.ts`](../../packages/evals/src/graders/protocol-checks.ts) | hardcode work_mem / deep protocol | 不是通用声明式 Harness contract grader |
| [`EvalRunOutput`](../../packages/evals/src/types.ts) | Session items + reply + usage | 缺最终语义 request 序列、route 序列和通用 RunEvent trace |
| [`summary.ts`](../../packages/evals/src/summary.ts) | by category / grading mode / feature surface | 缺 by Harness class / API profile / contract pass rate |
| [`LLMRequest`](../../packages/llm/src/protocol/types.ts) | tools、maxTokens、thinkingLevel、responseFormat | 尚不能表达所有要验证的跨 provider tool choice / response constraint 语义 |
| adapter | provider 请求与 normalize | 缺统一 capability status：supported / ignored / rejected / emulated |

当前工作树正在修改上述多个文件。本重构**不得与当前 eval PR 并行实现**；先完成、提交或明确放弃在途改动，再从固定 SHA 开始。

## 4. 目标领域模型

### 4.1 Case 声明

目标 schema 采用 clean break，不维护 `category` / `featureSurface` 双轨：

```typescript
type WorkloadCategory =
  | "coding"
  | "exploration"
  | "deep_task"
  | "general"
  | "regression"
  | "external_research";

type HarnessCaseClass =
  | "request_shaping"
  | "tool_decision"
  | "tool_loop"
  | "state_context"
  | "constraint_recovery";

interface EvalCaseBase {
  id: string;
  workloadCategory: WorkloadCategory;
  steps: EvalStep[];
  setup?: EvalCaseSetup;
}

interface WorkloadOutcomeCase extends EvalCaseBase {
  kind: "workload_outcome";
  expected: {
    outcome: OutcomeExpectation[];
  };
  outcomeGrading: "objective" | "subjective";
  rubricBullets?: string[];
}

interface HarnessContractCase extends EvalCaseBase {
  kind: "harness_contract";
  harnessClasses: HarnessCaseClass[];
  apiProfile?: string;
  expected: EvalExpectedContract;
  outcomeGrading?: "objective" | "subjective";
  rubricBullets?: string[];
}

type EvalCaseDefinition = WorkloadOutcomeCase | HarnessContractCase;

interface EvalExpectedContract {
  request?: RequestExpectation[];
  trace?: TraceExpectation[];
  outcome?: OutcomeExpectation[];
}
```

`expected.request`、`expected.trace`、`expected.outcome` 分别由三个 grader 解释。不要创建一个包含任意 path/value 的通用 matcher；每个 expectation 使用显式 discriminated union。

### 4.2 API profile

API profile 是 eval 声明，不是 runtime 隐式 env 集合：

```typescript
interface EvalApiProfile {
  id: string;
  semanticConfig: EvalSemanticConfig;
  expectedCapabilities: CapabilityExpectation[];
}
```

`semanticConfig` 只包含 MoonTide 明确定义的跨 provider 语义，例如：

- tool choice：none / auto / required / specified；
- response format；
- reasoning level；
- output token limit；
- provider / adapter / model pin（作为实验控制变量）。

DeepSeek `parallel_tool_calls`、`previous_response_id` 等专有或未支持字段不直接进入通用 `LLMRequest`。若产品需要对应语义，先定义 MoonTide 的跨 provider contract，再决定 adapter 是 supported、rejected 还是 emulated。

### 4.3 Capability 声明

adapter capability 表为声明层：

```typescript
type CapabilityStatus = "supported" | "ignored" | "rejected" | "emulated";
```

每条声明至少包含：

- semantic capability 名称；
- adapter family / provider preset；
- status；
- 可选限制；
- 对应 contract test 名称。

未知 capability 默认 rejected，不能静默当作 supported。

### 4.4 Eval observation

每个 arm 每次 repetition 需要保存：

```typescript
interface EvalRunObservation {
  llmCalls: EvalLlmCallObservation[];
  runEvents: RunEvent[];
  outcome: EvalRunOutput;
}
```

`EvalLlmCallObservation` 保存脱敏后的 semantic request、resolved route、response stop reason 与 usage。wire body 不进入该类型。

## 5. 不变量

实现前先把以下不变量写成测试名：

1. 每个 `harness_contract` case 的 `harnessClasses` 至少包含一项，并有与该 contract 对应的 request 或 trace oracle；
2. `workload_outcome` case 只计入 workload outcome 统计，不计入 Harness contract coverage；
3. `objective` case 不得只有 LLM judge rubric；
4. request expectation 只读取最终 `LLMRequest` observation；
5. trace expectation 只读取 RunEvent / tool execution / Session observation；
6. outcome expectation 不以 tool call 本身作为任务成功；
7. `tool_choice=none` case 出现工具调用必失败；
8. `tool_choice=required` case 在 final 前无合法工具调用必失败；
9. tool call 与 tool result 必须按 call id 配对；
10. tool result 后需要继续推理的 case 必须观察到下一次 LLM request；
11. unsupported / ignored capability 不得因 HTTP 200 被标记为 supported；
12. baseline/candidate 除声明的 intervention 外配置相同；
13. report 分别呈现 request、trace、outcome，不用单一总分掩盖失败层。

## 6. 分期实施

### Phase 0 — 固定起点

**目标：** 避免与当前未提交的 eval / adapter 工作相互覆盖。

步骤：

1. 完成当前 Eval PR Pipeline 和 LLM adapter 在途工作；
2. 运行 `pnpm run check`，记录固定 SHA；
3. 更新现行 [`harness-eval-1.0.md`](../spec/harness-eval-1.0.md) 到真实实现状态；
4. 为本重构创建独立 branch / issue，不复用未完成工作树。

**验收：** `git status` 范围明确，现有 v2 eval tests 全绿，固定点可复现。

### Phase 1 — Schema clean break

**目标：** 建立 workload / Harness class / API profile / oracle 四轴 schema，不改变 runner 行为。

文件：

- `packages/evals/src/types.ts`
- `packages/evals/src/suite-loader.ts`
- `packages/evals/tests/suite-loader.test.ts`
- `packages/evals/tests/suite-integrity.test.ts`

步骤：

1. 新增 `WorkloadOutcomeCase` / `HarnessContractCase` 判别联合、`WorkloadCategory`、`HarnessCaseClass` 与三类 expectation union；
2. 用 `workloadCategory` 替换 `category`；
3. 用 `harnessClasses` 替换 `featureSurface` 的 case 分类职责；
4. 用 `outcomeGrading` + `expected` 替换 `gradingMode` + `expectedChecks`；
5. suite loader 做声明式 conformance；
6. 不保留 legacy schema runtime 分支。

**验收：** invalid class、contract case 无 request/trace oracle、objective 无确定性 expectation、重复 case id 均在 suite load 时失败；workload-only case 不能进入 Harness coverage。

### Phase 2 — 一次性迁移 suite

**目标：** 机械迁移 v2 case，不改变 prompt、fixture 和现有 outcome 语义。

步骤：

1. 先迁移 `v2/regression`，验证 schema；
2. 依次迁移 coding、exploration、deep_task、general、external_research；
3. 原 `expectedChecks` 只迁到 `expected.outcome`；
4. 暂无 request / trace oracle 的 case 标记为 `workload_outcome`，不补虚假的 `harnessClasses`；
5. 只有能明确写出 contract 与 deterministic oracle 的 case 才升级为 `harness_contract`；
6. suite version bump 为 v3，删除旧 loader 分支。

**验收：** case 数、prompt、fixture hash 与迁移前对表；所有 v3 case 通过 conformance。

### Phase 3 — Observation ports

**目标：** 收集 request、route 和 RunEvent，而不增加新的业务事实源。

文件候选：

- `packages/evals/src/observations/llm-calls.ts`
- `packages/evals/src/observations/run-events.ts`
- `packages/evals/src/moontide-harness.ts`
- `packages/evals/src/types.ts`

步骤：

1. 在现有 `onLLMCall` / provider port 边界收集脱敏 `LLMCallRecord`；
2. 在 RunEvent bus subscribe 收集 run event；
3. 将 observation 放入 eval output / artifact，不写回 Session；
4. 定义 redaction：API key、Authorization、绝对敏感路径、未授权原文不得进入 report；
5. artifact 写入 `observations.jsonl`，manifest 只保存摘要与 hash。

**验收：** 一个两轮 tool case 能还原 request₁ → tool call → tool result → request₂ → final；Session Item Log 内容不因 observation 改变。

### Phase 4 — 三类 grader

**目标：** 将 grader 按证据层拆分，删除 hardcoded `protocol-checks` monolith。

目标文件：

- `packages/evals/src/graders/request-checks.ts`
- `packages/evals/src/graders/trace-checks.ts`
- `packages/evals/src/graders/outcome-checks.ts`
- `packages/evals/src/graders/rubric-judge.ts`

步骤：

1. 现有 reply / file checks 迁到 `outcome-checks.ts`；
2. tool-not-called、tool order、args、call/result pairing、next-request 等进入 trace checks；
3. tools schema、tool choice、response format、route 等进入 request checks；
4. work_mem / deep protocol 通过声明式 trace expectation 表达；
5. LLM judge 只处理 subjective outcome，不处理 request / trace；
6. report 为每层生成独立 pass rate 与 details。

**验收：** 每个 expectation kind 至少一个 pass 和 fail oracle test；删除旧 `protocol-checks.ts` 后无能力损失。

### Phase 5 — Adapter capability contracts

**目标：** 验证 API 配置是否真正可用，不把 provider 静默忽略当作成功。

文件候选：

- `packages/llm/src/adapters/capabilities.ts`（声明）
- 各 adapter impl 文件（实现）
- `packages/llm/tests/*-contract.test.ts`

步骤：

1. 建立 adapter capability 声明表；
2. 对 request mapping、response normalize、stream events、tool call/output 写 mock transport contract test；
3. DeepSeek Responses API profile 首批覆盖 tool_choice、function tool、web_search、response format、reasoning effort、max output；
4. 对 ignored / unsupported 参数写负向测试；
5. capability manifest 进入 eval run manifest，供真实 LLM run 解释结果。

**验收：** 每个 `supported` 声明都有 contract test；未知或 ignored 配置不能进入“配置有效”统计。

### Phase 6 — Runner、report 与小型真实模型验证

**目标：** 以 Harness class 和 API profile 组织实验，workload 只作为抽样维度。

步骤：

1. runner 支持 `--harness-class=`、`--api-profile=`；
2. A/B intervention manifest 显式记录唯一 config diff；
3. summary 增加 `byHarnessClass`、`byApiProfile` 和三层 pass rate；
4. neutral 是合法结果；只有预先声明 `expectLift` 才要求正向提升；
5. 新增 `suites/v3/contracts/`：每个 Harness class 至少 positive、negative、failure 三题；
6. L0/L1 使用 mock / recorded response，不需要 API key；
7. L2 只在少量 case 上用固定真实模型验证“provider 实际行为”，不重复 adapter unit test。

**验收：** 同一 case 可以明确显示 request pass、trace fail、outcome pass；merge gate 不会因 outcome 偶然成功掩盖 protocol failure。

### Phase 7 — Spec 与旧概念清理

**目标：** 实现完成后再更新正式 Spec，删除错误术语。

步骤：

1. 将 [`harness-eval-1.0.md`](../spec/harness-eval-1.0.md) 升级为 contract-first 版本；
2. 更新 [`agent-eval-roadmap.md`](agent-eval-roadmap.md) 的 L0–L3 定义；
3. 更新 README、Impact Card、CLI help；
4. 删除 `byFeatureSurface`、旧 `expectedChecks`、旧 `protocolChecks` 与 legacy suite loader；
5. 添加 conformance test，禁止 `harness_contract` case 只有 workload category 而无 contract oracle，并禁止 workload-only case 计入 Harness coverage。

**验收：** docs、types、CLI help、report schema 和 suite schema 一致；`pnpm run check` 零错误、警告和 info。

## 7. 建议小提交顺序

| Commit | 内容 |
|--------|------|
| `docs(evals): separate workload and harness taxonomies` | 本文档与 taxonomy 更新 |
| `feat(evals): define contract-first case schema` | 类型与 expectation union |
| `feat(evals): enforce contract suite conformance` | loader + invalid case tests |
| `feat(evals): migrate regression suite to v3` | 首个机械迁移样板 |
| `feat(evals): migrate remaining suites to v3` | 其余 suite 迁移 |
| `feat(evals): collect llm call observations` | semantic request + route evidence |
| `feat(evals): collect run event observations` | RunEvent trace evidence |
| `feat(evals): split request trace outcome graders` | 三层 deterministic grader |
| `feat(llm): declare adapter capability contracts` | capability table + contract tests |
| `feat(evals): report harness contract results` | runner、summary、report |
| `docs(evals): publish contract-first eval spec` | Spec、README、Impact Card 收敛 |

每个测试文件创建或修改后，先运行对应 `pnpm exec vitest run <file>`；所有源码变更完成后运行一次完整 `pnpm run check`。不运行 `pnpm run build`。

## 8. 整体 Done 定义

- [ ] Workload 与 Harness contract 是独立维度，case kind 明确区分 contract eval 与 workload outcome eval；
- [ ] 每个 contract case 至少有一个 request 或 trace 确定性 oracle；outcome oracle 可选；
- [ ] tool positive、tool negative、tool failure 均有 case；
- [ ] tool call 与用户结果分开判分；
- [ ] semantic request 和 RunEvent trace 可从 artifact 复盘；
- [ ] provider capability status 可审计；
- [ ] ignored / unsupported API 配置不会被报告为有效；
- [ ] report 可按 Harness class、API profile、workload 分别查看；
- [ ] L0/L1 无 API key 可跑；L2 真实模型 eval 是 opt-in；
- [ ] baseline/candidate intervention 单变量且可复现；
- [ ] 现有 workload prompt / fixture 迁移无语义损失；
- [ ] `pnpm run check` 全绿。

## 9. 非目标

- 不在本重构中覆盖所有 Responses API 参数；
- 不把 DeepSeek / OpenAI wire 字段直接加入 Agent Core；
- 不用一个通用 JSON path matcher 替代明确的 expectation 类型；
- 不把 HTTP 200、tool call 次数或 LLM judge 总分当作 Harness 正确性的唯一证据；
- 不同时重写 agent-core、Context Composer 和 provider architecture；
- 不把 v2/v3 schema 长期双轨运行；
- 不在当前未提交 eval 工作树上直接开始实现。

## 10. 风险与控制

| 风险 | 控制 |
|------|------|
| 当前 eval / adapter 改动并发冲突 | Phase 0 固定 SHA；独立 branch；不重叠工作树 |
| Schema 维度过多，case 难写 | 固定四轴；expectation 用小型 discriminated union；提供 3 个模板 |
| Provider 静默忽略参数 | capability status + adapter contract test + negative case |
| 模型随机性掩盖协议 bug | request / trace 先确定性判定；真实模型只测 provider behavior |
| 收集 request 泄露敏感数据 | eval-only collector、字段白名单、redaction、wire body 不落盘 |
| Tool 调用被误当成功 | outcome grader 与 trace grader分离；工具正负 controls |
| 重构破坏 58 个现有 case | 机械迁移、case/fixture hash 对表、按 suite 分提交 |
| Provider 特性污染通用协议 | 只有跨 provider 语义进入 `LLMRequest`；专有字段留 adapter |
