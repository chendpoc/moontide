# Session Chat UI References

> **用途：** MoonTide Desktop v0.1 Session Chat 内部设计参考
> **接收日期：** 2026-09-01
> **原始捕获日期：** 未知
> **来源：** 用户提供的第三方产品截图；仅供内部设计比较，不用于产品分发

这些截图只用于比较空间、密度和交互表达，不改变 MoonTide 的 Host、Session Item Log、
approval、event ordering 或 failure semantics。不得复制第三方 logo、mascot、品牌色、营销文案
或未被 MoonTide contract 支持的操作。

## 状态映射

- `deepseek-blank.png`
  - 原始文件：`crates/docs/ui-img/img2.png`
  - 产品：DeepSeek Chat Web
  - 状态：Blank Conversation
  - 参考：Session list 密度、中央主任务、Composer 内次要操作层级
- `deepseek-loaded.png`
  - 原始文件：`crates/docs/ui-img/img1.png`
  - 产品：DeepSeek Chat Web
  - 状态：Loaded Conversation
  - 参考：稳定 reading width、长文本排版、sticky Composer、当前 Session selection
- `unsloth-blank.png`
  - 原始文件：`crates/docs/ui-img/img4.png`
  - 产品：Unsloth App
  - 状态：Blank Conversation
  - 参考：大面积留白、居中欢迎语、单一大 Composer、左侧 Recent
- `unsloth-loaded.png`
  - 原始文件：`crates/docs/ui-img/img3.png`
  - 产品：Unsloth App
  - 状态：Loaded Conversation
  - 参考：compact user bubble、assistant plain surface、hover action row、底部 Composer

## 验收使用

- Blank 只比较 Sidebar density、留白层级、欢迎语/Composer 主次与单一 primary action。
- Loaded 只比较 reading width、user/assistant 区分、长内容节奏、sticky Composer 与 Loaded row。
- 不以品牌像素级相似为目标。
