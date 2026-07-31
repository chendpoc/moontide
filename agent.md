# Agent 协作偏好

## 用词：专业、简洁、清晰

**原则：** 文档、设计说明与对话中，优先使用业界可核对的专业术语；避免为省事而造的口语、隐喻或代指。

| 偏好 | 避免 |
|------|------|
| **API 适配层**、**adapter**、**Provider preset**、**Harness**（有明确定义时） | 自造黑话（如未定义的「Wire」指 HTTP 层） |
| 一词一义；新词首次出现给定义或链到 Spec | 隐喻代替精确描述（「最后一跳」「那层」不带结构名） |
| 与代码目录 / 接口名一致（`adapters/*`、`LLMProvider`） | 口头简称与正式文档用语不一致 |
| 简洁但不牺牲可检索性 | 过长绕述或堆砌缩写 |

**判据：** 读者能否在不问作者的情况下，从术语联想到**具体模块、边界或职责**；若不能，则换词或补一句定义。

**示例（Ocula）：**

- ✅ 「Harness 与 **API 适配层**分离」— adapter 负责 `LLMRequest` ↔ 厂商 SDK  
- ❌ 「Harness 与 Wire 分离」— Wire 非通用架构术语，易与 wire protocol 混淆  

**范围：** 架构文档（[`docs/`](docs/README.md)）、PR/Issue、Agent 产出物；口语讨论可临时用简称，**落盘时必须规范化**。

**文档索引：** [`docs/README.md`](docs/README.md) — `product/`（方向）、`spec/`（设计 Spec）、`notes/`（分析与候选）；文件名一律小写 kebab-case。
