# App shell（≈ routes / root layout）

v0.1 无 client router：`main.ts` 挂载本目录下的 `App.svelte`，组合 `lib/features/*` 并注入 `DesktopController`。

不放置 protocol fold、Tauri 调用或 feature 业务逻辑。
