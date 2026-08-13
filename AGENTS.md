本文件是 MoonTide **Instruction State** 来源：经 `instruction-state` 每 turn 拼进 `LLMRequest.system`。

**完整工程手册**（分层详表、Conformance 范围、术语全集、示例）见 [`docs/guides/engineering-handbook.md`](docs/guides/engineering-handbook.md)。维护规则：**runtime 必需、可执行的约束写本文件**；详述、表格与链接写 handbook。

---

## 对话风格

- 回答简短精炼；只写技术性文字
- 提交、issue、PR、代码中不用 emoji；不要客套填充语
- 用户提问时先回答，再改代码或跑命令
- 回应反馈时先明确同意或不同意，再说明改动

---

## 代码质量

- 大范围改动或审计前先完整读文件，不靠搜索片段
- 除非必要不用 `any`；单调用点单行 helper 内联
- 查 node_modules 类型，不猜 API
- **禁止内联导入**（`await import()`、`import("pkg").Type`）；只用顶层 import
- **`src/` 只提交 `.ts`**；编译产物仅在 `dist/`（ESM 的 `.js` import 后缀除外）
- **`_` 前缀 = 本文件私有**，不得 export
- 删有意功能前先问用户；除非用户要求，不做向后兼容

---

## 命令

- 代码变更后（文档除外）：`pnpm run check`（完整输出），修完所有 lint/type/test 再提交
- 未经用户要求：不跑 `pnpm run build`、不跑全量 `pnpm test`
- 改测试文件后：`pnpm exec vitest run tests/<name>.test.ts` 直到通过
- 规范单测：`pnpm run test:conformance`（pre-commit 已含）
- 临时脚本写 `/tmp` 等临时文件，不嵌多行 bash
- 未经用户要求不提交

---

## Git

cwd 可能有多 agent 并行；勿碰其他会话未暂存文件。

**提交：** 只提交本会话改动的文件；`git add <path>` 显式路径，禁止 `git add -A` / `.`；提交前 `git status`；信息格式 `{feat,fix,docs}[(scope)]: …`

**禁止：** `git reset --hard`、`checkout .`、`clean -fd`、`stash`、`git add -A`、`commit --no-verify`、force push

**rebase 冲突：** 只改本会话动过的文件；未改文件冲突则中止并问用户

---

## Issue 与 PR

- 审查 PR 不 `gh pr checkout` / 不切分支；用 `gh pr view/diff`、`git show <ref>:<path>`
- 评论用 `gh … comment --body-file`，不用 `--body` 传多行
- 关闭 issue：提交信息含 `fixes #n` 或 `closes #n`（多 issue 各写关键字）

---

## 工程原则（摘要）

1. **分层** — `utils/` → `storage/` → 业务；业务不直接 `node:fs` / spawn。Session Item Log 为事实源，Agent Event 仅 derive。
2. **高内聚低耦合** — `session/` 不 import `agent/`；permission 随 `ToolSpec` 注册。
3. **Spec / Impl 分离** — `*tools.ts` 与 handler 分文件；impl 无 `ToolSpec`，spec 无 IO 副作用。
4. **声明式注册表** — tool / hook / plugin manifest 用表驱动；新增 tool 改表不改长 switch。
5. **Conformance 守门** — 注册表变更须过 `tests/conformance/`；不变量写 oracle / 结构单测，热路径不加 runtime assert。
6. **简单冗余** — 不为省行数抽泛型；相似 store 可各写一份。

详表与示例：handbook §1–§6。

---

## 术语（摘要）

| 过程 | 用词 |
|------|------|
| Item Log → messages | **materialize** |
| Session → LLMRequest | **compile**（`composeContext`） |
| RunEvent → Agent Event | **derive** |

内核：**RunEvent bus**（不用 sink）、**resolveRunConfig** / **resolveTurnContext**（不用 fold 指 config）。插件不定义 RunEvent phase；sidecar 经 Harness observer 注册。

完整术语表：[`docs/spec/context-composer.md`](docs/spec/context-composer.md) §1.4 · [`docs/spec/agent-core.md`](docs/spec/agent-core.md) · handbook §7。

---

## 错误边界

- Tool 预期失败：return `"Error: …"`，handler 不 throw
- `runTool` / `runLLM`：唯一 catch → `toFailureOutcome`
- REPL turn 失败：`reportError`，REPL 继续（config fatal 除外）
- 排查：终端 ERROR 块 → `.moontide/runs/*.jsonl` → `/debug on`

详表：handbook §8。

---

## 用户覆盖

用户指令与本文件冲突时，先请求显式确认再覆盖。
