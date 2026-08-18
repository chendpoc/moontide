# 插件设计 Agent：用户扩展需求处理链路（候选设计）

> 状态：候选设计（notes），未实现。当前 Rust 系统设计见 [`agent-core.md`](agent-core.md)；执行优先级见根 [`TODO.md`](../../TODO.md)，本候选不属于当前 Desktop v0.1。

## 背景

用户不可避免会有自己的扩展需求。与其让用户直接写扩展，不如用一条受控的处理链路，由 agent 判断「要不要做扩展、怎么做」，最终产出功能插件实现或替代方案文档。

这里的 extension 指 MoonTide 的自主扩展候选：**MCP 进程 JSON-RPC + sidecar hook**（历史背景见 `docs/archive/spec/agent-core.md` §12、§15；尚未进入当前 Rust 契约）。

## 结论

- **流程层成立**：需求 → 产物 的流水线是合理的产品功能。
- **执行层后置**：本地小模型（LoRA 微调）draft → 远端大模型 review 是未来技术优化，当前不实现；先用 prompting + JSON schema + few-shot 验证链路。

## 流程

```
用户需求（口语化）
  ↓
[意图澄清] grill-me 式访谈（定制问题清单 + 决策树 + 终止条件）
  ↓
[结构化 brief]（意图分类 + 需求目标 + 待澄清项归零）
  ↓
[判断：需要扩展吗？]  显式决策树（能力覆盖 / 组合可行性）
  ├─ 不需要 → 替代方案文档
  └─ 需要 → [draft 设计]（对齐 MCP / sidecar 契约）
             ↓
          [review + 改进]
             ↓
          [门禁：llm-as-a-judge]（rubric 锚定契约，结构化打分）
             ├─ 不达标 → 打回 review
             └─ 达标 → 最终产物（插件实现 / 设计文档）
                        ↓
                     [人工确认点]（安装前）
```

## 三个枢纽（必须显式定义）

| 枢纽 | 必须显式化 | 锚点 |
|---|---|---|
| 判断 | 「要不要做插件」的决策标准 | 能力覆盖清单 + 组合可行性 |
| 设计 | draft 的产出格式 | MCP tool 定义 / sidecar hook 签名 |
| 校验 | review 的验收标准（rubric） | extension 契约 + 质量门槛 |

## 前置依赖（顺序约束）

1. **extension 契约先定稿**（MCP 协议 + sidecar hook schema）——否则 draft 格式与 judge rubric 无锚点（对应 TODO 17 / 18）。
2. **brief 的 JSON schema 先定义**——整条流程第一个要定死的产物格式。

## 执行选型（后置）

- 本地小模型：意图梳理、需求结构化、是否需插件的判断、draft 生成。
- 远端大模型：review + 改进，产出最终产物。
- LoRA 微调是最后手段，不是起点。顺序：prompting + schema + few-shot 验证 → 积累真实需求数据 → 出现稳定失败模式才对窄子任务（分类 / 抽取）微调，不微调端到端 draft 生成。

## 待验证

1. 本地 draft 到底帮远端省了多少（量化收益，决定该环价值）。
2. judge 的 rubric 与误判率（rubric 必须含可执行性、契约一致性等硬指标，软指标占小权重）。
3. 「是否需插件」的分类准确率。
