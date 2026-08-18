# Desktop Shell 候选路线

> **性质：** Candidate roadmap
> **状态：** Candidate；当前 P0/P1 见 [`../../product/desktop-development-direction.md`](../../product/desktop-development-direction.md)
> **来源：** 旧 TODO 的 Desktop、Panel、Action 和分类条目

## Candidate

### Desktop 视觉与交互

- 透明、虚化、背景和窗口过渡；
- Turn、Tool、Approval 和 Session panel 的动效；
- 多 panel dock、pin、resize 和多窗口布局；
- 统一的桌面状态栏与后台任务提示。

### Workspace 组织

- Project tree；
- Session、文件和产物的关联视图；
- 对话标签和自动分类；
- 工作目录、项目规则和最近活动的统一导航。

### Desktop 观测面板

- Tide：人和 Agent 的日常 Action 时间线；
- Fleet：多个 Agent 或后台任务的状态面板；
- Buoy：来自 Spark 的 pending capture 收件箱。

## Deferred

- 多 UI 窗口和 Fleet 依赖多 Session/后台运行语义；
- Buoy 依赖 Spark sync、身份和跨设备协议；
- Action 统计涉及系统级窗口、应用、浏览器和终端观测，不能只读取 MoonTide Session。

## 进入条件

1. Desktop v0.1 单 Session 主路径稳定；
2. UI 事件和 Session query 已形成稳定宿主 API；
3. 明确 panel 的数据源、权限和隐私边界；
4. 每个 panel 有独立验收结果，不以“视觉完成”代替功能完成。
