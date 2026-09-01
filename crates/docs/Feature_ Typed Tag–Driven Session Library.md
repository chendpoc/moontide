# Feature: Typed Tag–Driven Session Library

## 1. Summary

MoonTide 使用 **Session 作为核心工作对象，Typed Tag 作为统一的 Session 组织原语**。

不再分别引入：

- Project
- Folder
- Pin Group
- Recent Group
- Smart Folder
- Topic Group

等相互独立的组织机制。

统一模型：

```text
Workspace
└── Sessions
      │
      └── TagAssignment
              │
              ▼
             Tag
```

Session Library 则是：

```text
Session Library
    =
Sessions
+ Typed Tags
+ Tag Queries
+ Ranking
```

核心原则：

> **Session 是事实，Tag 是组织 Session 的统一原语。**

Project、Feature、Topic、Pinned、Inbox、Recent 等概念，都可以通过不同类型和行为的 Tag 表达。

---

## 2. Motivation

传统工作软件通常采用：

```text
Workspace
└── Project
    └── Folder
        └── Session / Document
```

这种模型要求用户主动维护信息架构：

- 创建 Project；
- 判断 Session 属于哪个 Project；
- 移动 Session；
- 创建 Folder；
- 整理 Folder；
- 维护分类结构。

对于 Agent 产品，这增加了不必要的管理成本。

MoonTide 更希望遵循：

```text
Start working
    ↓
Session naturally accumulates context
    ↓
Agent understands what the work is about
    ↓
Sessions are automatically organized
```

即：

> **Work first, organize automatically.**

用户应该首先开始工作，而不是首先决定“这次工作应该放在哪里”。

---

# 3. Core Domain Model

MoonTide 的主层级保持非常浅：

```text
Workspace
└── Session
```

Workspace 是 execution/context boundary。

Session 是用户持续工作的核心对象。

其他组织能力通过 Typed Tag 建立：

```text
Workspace
│
└── Session
     ├── Turns
     ├── Tasks
     ├── Agents
     ├── Files / Artifacts
     │
     └── Tags
```

其中：

- Turn = execution dimension
- Task = semantic work dimension
- Agent = actor dimension
- File / Artifact = resource dimension
- Tag = organization dimension

这些维度不继续形成固定的深层树结构。

---

# 4. Typed Tag

Tag 不能只是：

```ts
tags: string[]
```

MoonTide 使用 Typed Tag。

初始版本定义四类：

```ts
type TagKind =
  | "system"
  | "derived"
  | "semantic"
  | "manual";
```

## 4.1 System Tag

由 MoonTide 内置，并具有明确产品语义。

例如：

```text
#Inbox
#Pinned
```

典型行为：

### Inbox

New Session 默认进入：

```text
New Session
    ↓
#Inbox
```

当系统能够稳定完成 Session 分类后，可以自动离开 Inbox。

无法判断归属的 Session 保持在 Inbox。

因此 Inbox 表达：

> 尚未完成有效组织的 Session。

### Pinned

由用户显式操作：

```text
Pin
Unpin
```

Pinned 与其他 Tag 正交。

一个 Session 可以同时属于：

```text
#Pinned
#MoonTide
#Desktop
#UI
```

---

# 5. Derived Tag

Derived Tag 是动态计算得到的 Tag。

例如：

```text
#Recent
#Today
#ThisWeek
```

它们在 UI 上与普通 Tag 使用统一交互模型，但 membership 不需要持久化。

例如：

```text
#Recent
```

可以由：

```text
ORDER BY last_active_at DESC
LIMIT N
```

动态得到。

不应该持续执行：

```text
add #recent
remove #recent
```

因此需要区分：

```text
Tag UI abstraction
```

与：

```text
Tag membership implementation
```

用户看到的是统一 Tag。

底层可以是 stored 或 computed membership。

---

# 6. Semantic Tag

Semantic Tag 由 Agent 根据 Session 内容自动理解和维护。

例如：

```text
#MoonTide
#Desktop
#UI
#AgentRuntime
#Memory
#Companion
```

例如 Session：

```text
"Refine Floating Island approval interaction"
```

可能得到：

```text
#MoonTide       0.99
#Desktop        0.96
#UI             0.92
#AgentRuntime   0.41
```

Semantic Tag 应支持 confidence。

```ts
interface SessionTagAssignment {
  sessionId: string;
  tagId: string;

  source: "system" | "agent" | "user";

  confidence?: number;
}
```

低置信度 Tag 不一定立即进入主要 UI。

---

# 7. Manual Tag

用户仍然可以显式创建和分配 Tag。

例如：

```text
#Important
#Research
#Later
```

Manual Tag 与 Semantic Tag 在 UI 上可以共享相同视觉语言。

区别主要存在于 ownership：

```text
agent-created semantic tag
        ↓
agent may maintain/re-evaluate

user-created/manual tag
        ↓
agent must not silently remove
```

用户显式行为具有更高 authority。

---

# 8. Tag Model

初始数据模型可以抽象为：

```ts
interface Tag {
  id: string;
  name: string;

  kind:
    | "system"
    | "derived"
    | "semantic"
    | "manual";

  origin:
    | "system"
    | "agent"
    | "user";

  membership:
    | {
        type: "stored";
      }
    | {
        type: "computed";
        rule: TagRule;
      };

  priority: number;
}
```

Assignment：

```ts
interface SessionTagAssignment {
  sessionId: string;
  tagId: string;

  source:
    | "system"
    | "agent"
    | "user";

  confidence?: number;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

# 9. Session Library

Session Library 不再以传统 Project Tree 为核心。

默认结构：

```text
ALL

Inbox                              3
Pinned                             5
Recent                            12

GROUPS

MoonTide                          24
Desktop UI                        13
Agent Runtime                      9
Memory                             7
Research                           4
```

点击任何 Tag，本质都是：

```text
Tag
 ↓
resolve membership
 ↓
Session Set
 ↓
rank
 ↓
render
```

因此从 UI 角度：

```text
Inbox
Pinned
Recent
MoonTide
Desktop UI
Memory
```

都是相同类型的 Navigation Destination。

用户不需要理解：

```text
Inbox = persisted state
Pinned = user preference
Recent = temporal query
MoonTide = semantic classification
```

这些属于实现细节。

---

# 10. All View

`All` 是整个 Session Library 的入口。

它不是一个普通 semantic tag，而是所有 Session 的基础集合。

```text
All Sessions
│
├── Inbox
├── Pinned
├── Recent
│
└── Groups
    ├── MoonTide
    ├── Desktop UI
    ├── Agent Runtime
    └── Memory
```

因此：

> **All 是 universe，Tag 是 projection。**

---

# 11. Project Is Not a First-Class Entity

MoonTide 初始模型不引入独立 `Project` domain entity。

例如：

```text
#MoonTide
#FinancialAgent
#Game
```

都可以首先作为 Semantic Tag 存在。

长期稳定的 Semantic Tag 可以拥有：

- high stability
- high priority
- high session count
- long historical persistence

UI 可以据此将其提升为：

```text
PROJECTS

MoonTide
Financial Agent

TOPICS

Desktop UI
Memory
Agent Runtime
```

但：

```text
Project
Topic
Feature
```

暂时只是 Semantic Tag 的 UI projection，而不是三个不同的数据实体。

因此：

> **Project 可以是高稳定度、高权重的 Semantic Tag，而不需要成为 Session 的 ownership boundary。**

---

# 12. Feature / Topic Hierarchy

不应因为需要：

```text
MoonTide
└── Desktop
    └── Companion
```

就重新建立传统 Folder Tree。

Session 可以同时拥有：

```text
#MoonTide
#Desktop
#Companion
```

未来如果确实需要 hierarchy，可以为 Tag 建立 relationship：

```text
parent(#Desktop) = #MoonTide
parent(#Companion) = #Desktop
```

UI 可以投影：

```text
MoonTide
└── Desktop
    └── Companion
```

但 Session 本身仍然不是：

```text
Session belongs exclusively to Companion folder
```

原则：

> **Hierarchy is a view, not Session ownership.**

---

# 13. Auto Tagging

自动 Tag 不应允许 Agent 无限创建新标签。

否则很容易产生：

```text
#frontend
#front-end
#frontend-ui
#desktop-ui
#UI
#interface
#ux
```

最终形成 Tag Explosion。

Agent 在创建新 Semantic Tag 前应该：

```text
Session context
      ↓
retrieve existing relevant tags
      ↓
semantic matching
      ↓
reuse existing tag?
   ┌───────┴───────┐
  YES              NO
   ↓                ↓
assign          candidate tag
existing            ↓
tag             consolidation
```

默认原则：

> **Prefer reuse over creation.**

---

# 14. Tag Consolidation

系统需要轻量 Tag consolidation。

需要能够识别：

```text
#frontend
#front-end
#frontend-ui
```

可能属于同一个 semantic cluster。

未来可以支持：

```text
merge
alias
parent-child
deprecate
```

例如：

```text
#frontend-ui
    ↓ alias
#UI
```

或者：

```text
#Companion
    ↓ parent
#Desktop
```

但 v0.x 不需要立即提供复杂的 Tag Management UI。

---

# 15. Tag Authority

不同来源的 Tag 必须有明确 authority。

建议：

```text
User explicit action
        >
System deterministic state
        >
Agent inference
```

例如：

Agent 推断：

```text
#Desktop
```

用户删除：

```text
Remove #Desktop
```

Agent 不应该下一轮立即重新加回来。

需要记录类似：

```text
user rejected assignment
```

避免 Agent 与用户反复争夺分类权。

同样：

```text
user-created tag
```

Agent 不应静默删除。

---

# 16. Tag Lifecycle

Semantic Tag 应有生命周期，而不是永久累积。

基本状态可以考虑：

```text
candidate
    ↓
active
    ↓
stable
    ↓
inactive
    ↓
archived / merged
```

例如：

### Candidate

Agent 首次发现潜在新主题。

### Active

多个 Session 开始使用。

### Stable

长期存在、拥有较高使用频率。

例如：

```text
#MoonTide
```

### Inactive

长期没有 Session 活动。

### Archived / Merged

被其他 Tag 替代或合并。

这为长期 Session Library 自动整理提供基础。

---

# 17. Session Lifecycle

New Session：

```text
Create Session
      ↓
#Inbox
      ↓
conversation develops
      ↓
semantic understanding
      ↓
retrieve existing tags
      ↓
assign semantic tags
      ↓
classification confidence sufficient
      ↓
leave #Inbox
```

例如：

```text
New Session
"How should MoonTide session navigation work?"

#Inbox
   ↓

Agent classification

#MoonTide
#Desktop
#UI
   ↓

Inbox resolved
```

之后用户 Pin：

```text
#Pinned
#MoonTide
#Desktop
#UI
```

Session 最近活跃，因此同时动态出现在：

```text
#Recent
```

同一个 Session 可以自然存在于多个 Group 中。

---

# 18. Relationship With Agent / Task / Turn / File

Typed Tag 解决的是 Session organization，而不是所有 domain relationship。

MoonTide 仍然保持：

```text
Workspace
└── Session
```

Session 内部：

```text
Session
├── Tasks
├── Turns
├── Agents
├── Files
└── Tags
```

其中：

```text
Task
= what are we trying to accomplish?

Agent
= who is doing it?

Turn
= what execution happened?

File
= what resource was affected?

Tag
= how do I find and organize this work?
```

这些概念不应该强制形成：

```text
Session
└── Agent
    └── Task
        └── Turn
            └── File
```

底层关系更接近 graph。

UI 根据需要提供不同 projection。

---

# 19. UI Principles

## One organization primitive

用户不需要学习：

```text
Project
Folder
Smart Folder
Pin Collection
Recent Collection
Topic
Category
```

主要组织语言统一成：

> Tag / Group

---

## Low management cost

默认：

```text
New Session
```

即可开始工作。

不要求：

```text
Select Project
Select Folder
Choose Category
```

---

## Progressive organization

开始时：

```text
Inbox
```

随着工作发生：

```text
Inbox
    ↓
MoonTide
Desktop
UI
```

系统逐渐理解，而不是要求用户预先建模。

---

## UI abstraction unified, semantics typed

视觉层：

```text
#Inbox
#Pinned
#Recent
#MoonTide
```

可以保持统一。

领域层：

```text
system
derived
semantic
manual
```

严格区分。

---

# 20. V0 Scope

v0.x 应保持克制。

### P0

实现：

- Session Library
- All
- Inbox
- Pinned
- Recent
- Typed Tag model
- Semantic Tag assignment
- 基础 Tag filtering
- Existing-tag-first auto classification

### P1

增加：

- Tag confidence
- User correction
- Tag search
- Tag ranking
- Tag alias
- Candidate Tag
- 基础 consolidation

### Later

考虑：

- hierarchical Tag projection
- Smart Tags
- complex query groups
- automatic tag merging
- Tag lifecycle management
- cross-workspace semantic groups
- Agent-generated saved views

---

# 21. Non-Goals

当前 Feature 不负责：

- 建立完整 Project Management 系统；
- Folder Tree；
- Task Manager；
- multi-agent orchestration；
- File ownership hierarchy；
- arbitrary database query builder；
- 完整知识图谱；
- 自动建立复杂 taxonomy。

这些能力未来可以消费 Typed Tag / Session metadata，但不应该进入当前 feature scope。

---

# 22. Design Principle

最终模型：

```text
                    Workspace
                        │
                        ▼
                     Sessions
                        │
                ┌───────┴───────┐
                │               │
              Facts         TagAssignment
                                │
                                ▼
                             Typed Tag
                                │
          ┌─────────┬───────────┼──────────┐
          ▼         ▼           ▼          ▼
       System    Derived     Semantic    Manual
          │         │           │          │
       Inbox     Recent      MoonTide    Research
       Pinned    Today       Desktop     Important
```

Session Library：

```text
All Sessions
    ↓
Typed Tags
    ↓
Session Sets
    ↓
Ranking
    ↓
Navigation / Search / Groups
```

核心原则：

> **Session is the work object. Tag is the organization primitive.**

以及：

> **Work first. Organize automatically.**

MoonTide 不要求用户先设计自己的工作目录结构，而是让组织结构随着 Agent 对长期工作的理解逐渐形成。