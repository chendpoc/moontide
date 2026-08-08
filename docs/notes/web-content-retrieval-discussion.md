
> **状态：** 讨论记录 · **非 Spec / 非实现承诺**  
> **来源：** Deep Task Mode 外研场景观测（2026-08）— 模型 thinking 出现「嵌套 artifact 引用太多，改直接去抓维基页面」  
> **关联：** [`deep-mode.md`](deep-mode.md) · [`truncation-strategies.md`](truncation-strategies.md) · [`context-backlog.md`](context-backlog.md) · [`agent-activity-model-discussion.md`](agent-activity-model-discussion.md) · [`tools/builtins/README.md`](../../packages/tools/src/builtins/README.md)

---

## 1. 现象（一句话）

Agent 在外研类 deep 任务中，通过 `http_fetch` / 多轮 `read_artifact` 追逐 `[artifact:…]` 指针链读网页/HTML，**成本高于直接再 fetch 一次 URL**；模型会放弃 artifact 链，重复请求同一来源。

---

## 2. 问题拆解

### 2.1 典型链路

```text
http_fetch(URL) → body 超 cap / truncate
  → L3 spill：[artifact:xxx · N bytes — use read_artifact]
  → read_artifact → 整页 HTML，仍难消费
  → 再 fetch 其他链接 → 又一个 artifact
  → 模型：「嵌套引用太多，我直接抓维基吧」
```

### 2.2 根因（不是缺 workspace grep）

| 维度 | 说明 |
|------|------|
| **已有能力** | `grep` 仅搜**工作区**本地文件（`rg`/`grep`）；[`prompt.ts`](../../apps/moontide/src/agent/prompt.ts) 已写 Prefer grep over bash for **code search** |
| **实际缺口** | 在 **外网/HTML/spilled artifact** 内定位与阅读正文 |
| **与 Cursor 类比** | Cursor 的 Grep = 代码库搜 needle；Web 阅读 = 另一工具面（WebSearch / Fetch + 正文提取），**不应**用 duplicate workspace grep 解决 |

### 2.3 与 Deep Task Mode 的交叉

- Protocol 要求 `work_mem note` 带 `ref`，**禁止 raw tool dump**（[`deep-task-system.ts`](../../packages/context-composer/src/deep-task-system.ts)）
- 若外研链路本身返回巨大 HTML blob，模型要么违规贴 dump，要么在 artifact 链上耗 turn
- 外研 deep 任务（[`deep-mode.md`](deep-mode.md) 非目标：不替代 `deep_research`）与 **`deep_research`（Tavily，默认未注册）** 边界需在产品层说清

---

## 3. 设计原则（讨论共识）

1. **按意图分 tool**，不扩展现有 `grep` 语义到 URL/artifact（避免一 tool 多义）
2. **减少 pointer 链深度**：fetch 时尽量返回可消费的文本，而非整页 HTML + spill
3. **对齐 truncation recovery**：已有 [`truncation-strategies.md`](truncation-strategies.md) 决策树；外网场景需补「HTML → 正文 / 段落搜索」分支
4. **外研优先 structured search**：`deep_research` > 连环 `http_fetch` + `read_artifact`
5. **零代码优先**：在 AGENTS / tool description 写清 workflow，再考虑新 tool

---

## 4. Feature Backlog（候选，按优先级）

| # | 特性 | 级别 | 概要 | 代价 / 备注 |
|---|------|------|------|-------------|
| **W1** | `http_fetch` 正文提取 | **P1** | 可选 `format: text` / `extract: main`：HTML → 可读正文（readability 或轻量 strip） | 依赖 HTML 解析库；需测维基/新闻/JS-heavy 页 |
| **W2** | `http_fetch` 段落过滤 | **P1** | 可选 `query` / `section`：只返回含关键词的段落（**外网版 in-content search**） | 与 W1 组合；避免整页进 context |
| **W3** | `read_artifact` 分页 / 模式搜索 | **P2** | 扩展 `read_artifact`：`offset`/`limit` 或 `pattern`（artifact 内 rg） | 缓解已 spill 的大 blob；见 truncation-strategies |
| **W4** | 维基 / MediaWiki 快捷路径 | **P2** | 识别 `*.wikipedia.org` → MediaWiki API `prop=extracts` | 针对高频外研源；非通用 |
| **W5** | 启用并强化 `deep_research` | **P2** | `MOONTIDE_DEEP_RESEARCH=1`；tool 文案写「外研首选，避免连环 http_fetch」 | 需 Tavily key + ask 权限；与 Deep Mode 正交 |
| **W6** | `search_artifact` 独立 tool | **P3** | 在 session artifact 上 grep，返回 match 行 | 仅当 W3 扩展 `read_artifact` 过重时考虑 |
| **W7** | duplicate workspace `grep` | **非目标** | 再注册一个「阅读用 grep」 | ❌ 与现有 `grep` 重复，且不覆盖 URL/HTML |

### 4.1 建议 PR 顺序（若立项）

```text
W5（文案 + 默认策略）→ W1 → W2 → W3 → W4
```

W5 可无代码或仅改 prompt/tool description；W1–W2 解决主路径；W3 兜底已 spill 内容。

### 4.2 验收标准（讨论稿）

| 场景 | 期望 |
|------|------|
| `deep:` + 维基类问题 | ≤2 次 network tool 得到可用正文片段；无 3+ 层 `[artifact:…]` 链 |
| `work_mem note` | `ref` 为 URL / artifact_id / 标题，无 HTML dump |
| truncate 后 recovery | footnote `[strategies]` 指向 W2/W3，而非重复 `http_fetch` 同一 URL |

---

## 5. 非目标

- 用 workspace `grep` 读网页或 artifact
- 为 deep 外研自动开启 `deep_research`（保持 opt-in）
- 第一版支持任意 JS SPA 全站渲染
- 替代 Context Composer L3 spill 机制（只改善消费方式）

---

## 6. 开放问题

- [ ] W1 正文提取：内置依赖 vs 可选 `code_repl` template？
- [ ] `http_fetch` body cap（51KB）对外研是否Permanent 瓶颈，是否需「摘要-only」返回模式？
- [ ] Deep Mode system appendix 是否加一条：**外研用 `deep_research` 或 `http_fetch?format=text`，勿连环 read_artifact**？
- [ ] 与 Agent Activity Model `gather.search` vs `gather.explore` 的标签映射（见 [`agent-activity-model-discussion.md`](agent-activity-model-discussion.md)）

---

## 7. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08 | 初稿：artifact 嵌套现象、与 workspace grep 区分、W1–W7 backlog |
| 2026-08 | 关联 [`agent-eval-roadmap.md`](agent-eval-roadmap.md) D 桶 infra_penalty |
