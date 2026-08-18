# Agent 评测候选路线

> **性质：** Candidate roadmap
> **状态：** Candidate；不作为当前功能完成度的替代证明
> **来源：** 旧 TODO 的 Feature baseline、prompt scoring、nightly 和公开 benchmark 条目

## Candidate

- Rust eval harness：case 定义、mock provider、grader 和 baseline delta；
- deterministic tool/turn conformance suite；
- nightly 真 LLM smoke test 与成本/时延 artifact；
- prompt rubric grader 和 guard metrics；
- coding、多工具、deep protocol 分桶；
- SWE-bench 子集或其他公开 coding benchmark；
- 对 DSBench 等外部评测集做任务形态研究，不把不可复现的官方分数当作当前验收标准。

## Deferred

- 评测不能替代单元测试、结构测试和真实 provider smoke test；
- 在 Desktop v0.1 主路径稳定前，不把大型 benchmark 作为架构前置；
- 不恢复旧 TypeScript eval harness、旧 baseline 或旧 subprocess worker。

## 进入条件

- 明确评测要验证的 runtime contract 或产品结果；
- 每个 grader 有输入、输出、失败分类和回归阈值；
- 结果能区分模型能力、工具能力、Context 能力和宿主 UI 能力。
