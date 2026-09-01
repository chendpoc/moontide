# MoonTide composite components

跨 feature 复用的 **无业务状态** UI。v0.1 Chat 业务组件优先留在 `features/chat/`；没有第二个
消费者时，不把 message、Session row 或 Composer 提前抽到本目录。

- 可依赖 `$lib/components/ui/*`（Tailwind / shadcn）
- 自研样式：**Tailwind** + `styles.css` 中的 `.mt-*`（`@layer components`）或 Svelte scoped 原生 CSS
- 通过 props / snippets 接收数据，不 import `controller` 或 `bridge`
- 不 fork shadcn 源文件
