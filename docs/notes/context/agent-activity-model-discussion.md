
> **状态：** 讨论记录 · **非 Spec / 非实现承诺**  
> **来源：** 对照 Cursor 终端 activity（read · grepped · explored · thought）的启发（2026-08）  
> **关联：** [`context-window-roadmap.md`](context-window-roadmap.md) §7 · §8.2 · [`context-backlog.md`](context-backlog.md) §8 · [`TODO.md`](../../../TODO.md) §15.2 · [`context-analysis.md`](context-analysis.md) · [`session-handoff.md`](../session/session-handoff.md) · [`deep-mode.md`](deep-mode.md)

---

## 1. 讨论背景（一句话）

Cursor 展示的是 **认知动作**（在读 / 在搜 / 在探索 / 在想），不是 API 名。MoonTide 的启发：**观测分层** + **补 explore 编排**，而不是复制 Cursor 工具分类或 UI 文案。

---

## 2. 核心分层

| 层 | 内容 | MoonTide 现状 |
|----|------|---------------|
| **实现层** | Tool registry：`read_file`、`grep`、`bash`… | 已有 |
| **语义层** | Activity class：用户/终端看到的「在干什么」 | **缺口**（部分：trace 有 think vs tool） |
| **编排层** | Explore = 隔离子 run + bounded 回传 | **缺口**（无一等 explore；有 `deep_research` / Deep Mode，边界不同） |

**已对齐：**

- `reason.think`：`thinking` 与 `tool_use`/`tool_result` 在 trace 中分离（`format-trace.ts`）
- `gather.read` / `gather.search`：工具能力已有；缺统一 activity 标签
- 观测三档：`/thinking` · `/verbose` · `/debug`

---

## 3. 三条工作方向（roadmap 7a–7c）

### 3.1 7a — 工具 registry 与 activity class 解耦

**Taxonomy（示意，不必抄 Cursor 命名）：**

```text
gather.read | gather.search | gather.explore | act.shell | act.edit | reason.think
```

**原则：**

- Registry 仍用实现名；映射表 `tool name (+ input heuristic) → activity class`
- 落点：Agent Event / trace / statusline / i18n；**不改** hook phase、**不改** LLM tool schema
- 默认 fallback：`gather.other` / `act.other`

**非目标：**

- 不为对齐 UI 新增 `explored` / `thought` **假 tool**
- 不把 activity class 当作模型可见的 `[L1]` 优先级标签（见 context-backlog §3.3）

---

### 3.2 7b — Agent 指令写清「广度阶梯」

**零代码优先：** 在 `AGENTS.md` / rules 约定 workflow。

```text
read（定点） → grep（搜针） → explore（扫库） → act（改/跑）
                    ↑
            reason.think（选路，发生在工具之间）
```

| 情境 | 优先动作 |
|------|----------|
| 已知文件路径 | read |
| 已知符号 / 字符串 | grep |
| 不知从哪找 | 并行 read/grep，或（将来）explore |
| 大段 tool 输出 | spill + `read_artifact`（Budget L3） |

**目的：** 减少 `bash find | xargs cat` 等反模式；与 Deep Task Mode（任务记忆）正交。

**注意：** 阶梯是 soft policy；Permission 仍按真实 tool 名，不能因 activity 误分类而绕过。

---

### 3.3 7c — Explore MVP（不必先做完整 subagent）

| 阶段 | 形态 |
|------|------|
| **MVP A** | 同一 run 内 **并行 tool batch** + prompt 约束「只回摘要」 |
| **MVP B** | Sidecar：固定 explore prompt + 独立 runId + **仅回传摘要** |
| **远期** | fork/fresh subagent；与 Claude subagent、session-handoff 对齐 |

**边界（务必写清）：**

| | Explore | `deep_research` | Deep Task Mode |
|---|---------|-----------------|----------------|
| 目的 | 广搜、找在哪 | 长链路研究 | 任务级工作记忆 |
| Context | 要隔离/摘要 | 可长、可 spill | L1 Working Set |
| 用户感知 | 「在扫库」 | 「在调研」 | 「deep: 任务态」 |

---

## 4. 推荐落地顺序

```text
7b 广度阶梯（instruction）     ← 可立刻做，几乎无代码
    ↓
7a activity 映射（观测）       ← 独立 PR
    ↓
7c explore MVP（先 A 后 B）     ← 架构影响最大
```

7a 与 7b 可并行；7c 依赖对 explore 语义共识，避免做成「第四个 grep 变体」。

---

## 5. 待讨论问题（重启讨论从此节开始）

### 5.1 架构 / 落点

- [ ] **Activity 映射表放哪？** `tools/` 旁静态表 · `tool-use-log` 派生 Event 时 · Tool manifest 可选字段 · 独立 `activity/` 模块？
- [ ] **Event schema：** 是否在 Agent Event 增加 `activityClass` 字段，还是仅 trace 层推导？
- [ ] **Statusline：** 是否显示 `gather.read foo.ts`？与现有 **L2 %** 如何并排？
- [ ] **Plugin 生态：** 第三方 tool 默认 `act.other`；是否允许 manifest 声明 `activityClass`？

### 5.2 7b 指令

- [ ] 默认 rules 写进 repo 模板，还是仅文档建议用户自备 `AGENTS.md`？
- [ ] 广度阶梯与 **Deep Mode** 的 prompt 如何共存（同一段 system 还是分节）？
- [ ] 是否需要 **反模式清单**（禁止 find|xargs、禁止用 bash 代替 grep 等）写进 instruction？

### 5.3 7c Explore

- [ ] **MVP 选 A 还是 B？** A 不隔离 context，L2 仍可能爆；B 成本高但更贴近 Cursor explored。
- [ ] 并行 tool batch：现有 agent loop 是否支持同一 turn 多 tool 并行，还是需改 runTool 调度？
- [ ] Sidecar explore：与 [`plugin-host.md`](../runtime/plugin-host.md) / sidecar supervisor 如何挂钩？
- [ ] Explore 结果 **bounded 上限**（token/条数）是否与 L3 spill 共用策略？
- [ ] Parent 如何引用 explore 结果（一条 user 摘要 vs CompactionSave vs artifact）？

### 5.4 与 Context 演进的关系

- [ ] Activity 标签是否写入 **Context Manifest**（可审计「本轮主要在 explore」）？
- [ ] Explore 子 run 的 token 是否计入 parent 的 L2，还是单独子账？
- [ ] 与 [`context-normalization.md`](context-normalization.md) preflight 边界：explore 算 normalization 还是 agent 编排？

### 5.5 产品 / 观测

- [ ] i18n：中文 activity 文案（精读 / 检索 / 探索 / 执行 / 编辑 / 思考）定稿？
- [ ] `/thinking` trace 是否从 `tool` 改为显示 activity class，还是双行（class + tool 名）？
- [ ] 是否需要 **metrics**（每 session gather vs act 占比）用于评估 7b 是否生效？

---

## 6. 讨论中已共识的「不要做的」

1. 不新增 `explored` / `thought` 假 tool  
2. 不为抄 Cursor UI 硬编码英文动词  
3. 不把 explore 与 `deep_research`、Deep Task Mode 混为一谈  
4. 不把 activity class 塞进 tool schema 给模型当优先级标签  

---

## 7. 相关代码锚点（讨论时对照）

| topic | 路径 |
|--------|------|
| Trace kind | `src/log/format/format-trace.ts` |
| Tool 注册 | `src/tools/register-defaults.ts` |
| Agent Event / tool-use-log | `src/plugins/builtin/tool-use-log/` |
| Instruction | `src/instruction-state/` |
| Deep Mode / Working Set | `src/agent/deep-mode.ts` · `docs/notes/context/deep-mode.md` |
| Context L2/L3 | `src/context/composer/budget/` |

---

## 8. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08 | 初稿：Cursor 对照讨论、7a–7c、开放问题清单 |

---

## 9. 下一步（讨论恢复 checklist）

1. 选定 **7b** 是否先落默认 instruction 片段（可复制进 AGENTS 模板）  
2. 对 **5.1** 映射表落点拍板 → 可开 7a 小 PR  
3. 对 **5.3** A/B 选型拍板 → 写 7c 一页纸 spec  
