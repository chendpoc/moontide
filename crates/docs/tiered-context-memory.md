# 分层 Context 与长期记忆（L0/L1/L2 + session→memory 蒸馏）

> 状态：候选设计（notes），未实现。借鉴 OpenViking 的设计思想，不引入其代码 / 服务。

## 背景

OpenViking（volcengine 开源的 context database for AI agents）把 memory / resources / skills 组织成 `viking://` 虚拟文件系统，agent 用 `ls` / `tree` / `find` 语义浏览而非查黑盒向量库。核心机制：三层懒加载、确定性 URI、可观测检索、session→memory 蒸馏。

我们借鉴其**设计思想**，不引入其代码 / 服务（AGPLv3 传染 + Python server，与 Rust 单核不符）。

## 结论

- 借鉴三个思想：**L0/L1/L2 分层懒加载**、**确定性 URI + 检索轨迹**、**session→memory 异步蒸馏**。
- 自研 Rust 精简版分层 memory；若复用其服务，仅走 MCP 协议（进程隔离），绝不 embed。

## 三个设计思想

### 1. L0/L1/L2 分层懒加载

- 写入时预处理：L0（~100 token 摘要）/ L1（~2k token 概览）/ L2（原文）。
- **目录自身带 `.abstract` / `.overview`**，读全文前就能判相关性。
- 读取按需下钻，只加载任务所需的深度。

### 2. 确定性 URI + 可观测检索

- 每个 item 有确定性 URI，agent 用文件系统语义浏览。
- 每次检索保留目录浏览轨迹，结果错误时可追溯到产生它的路径。

### 3. session→memory 异步蒸馏

- session commit 后，异步抽取用户偏好 + agent 经验到长期记忆。

## 边界（关键）

- **短期 session**（Session Item Log）：确定性、可重放、机械断言，是 source of truth。
- **长期记忆检索**：概率性（向量打分）、辅助。
- 二者边界画死：检索结果不得污染 Composer 的确定性投影。

## 前置依赖与时机

- 内核 Rust 化（TODO 16）+ 跨语言契约（17 / 18）落地之后。
- 与 Local Fusion（15.3）联动：本地小模型是摘要蒸馏的候选执行方。

## 待验证

1. 摘要损失性（L0 丢关键信息）与 LLM 写入成本 / 延迟的 ROI 量化。
2. 向量检索（概率）与确定性 URI（可重放）的取舍。
3. 自研 Rust 精简版 vs 挂 OpenViking MCP 后端的对比决策。
