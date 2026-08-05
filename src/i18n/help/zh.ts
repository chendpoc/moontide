import { ACTIVE_EVENTS_SUFFIX, DATA_DIR, RUNS_DIR } from "../../constants/storage.js";
import { APP_ENV, envVarName } from "../../constants/env.js";
import type { HelpStrings } from "./types.js";

const configPath = `${DATA_DIR}/config.toml`;
const langEnv = envVarName(APP_ENV.LANG);

export const helpZh: HelpStrings = {
  title: "REPL 命令",
  exit: "退出",
  exitSummary: "离开 REPL",
  legend: `Statusline: 2.2k/128k(1.7%) · turn N · /statusline · 事件 → ${DATA_DIR}/${RUNS_DIR}/<runId>${ACTIVE_EVENTS_SUFFIX}`,
  languageHint: (lang) => `语言: ${lang} · 切换: /settings lang en|zh`,
  categories: {
    general: "通用",
    session: "会话",
    context: "上下文",
    observability: "可观测",
  },
  summaries: {
    "/help": "显示命令列表",
    "/reset · /new": "新会话（当前会话自动写入 index）",
    "/always-allow on|off|status": "自动批准 ask 类工具（deny 规则仍生效）",
    "/status": "会话 + compact auto 状态（status line 常驻在提示符上方）",
    "/workdir [path]": "查看或切换工作目录",
    "/settings lang en|zh|status": `UI 语言（写入 ${configPath}；未配置时用 ${langEnv}）`,
    "/save": "将当前会话写入 index",
    "/save list": "列出已保存与磁盘上的会话",
    "/resume session <session-id> [checkpoint-id]": "跨重启加载历史会话",
    "/resume <checkpoint-id>": "在当前会话内恢复 checkpoint",
    "/checkpoint [label]": "快照当前 turn",
    "/checkpoint list": "列出当前会话的 checkpoint",
    "/compact": "prune 旧 tool_result（写 compaction item）",
    "/compact preview": "dry-run token 估算",
    "/compact summary": "LLM 摘要压缩（额外 API 调用）",
    "/compact auto on|off": "切换超阈值自动 prune",
    "/thinking on|off|status": "调用链 trace（thinking · tool · result）",
    "/statusline [set <ids>|reset|preview|status]": `配置 status line 字段（写入 ${configPath}）`,
    "/verbose on|off|status": "context 单行 + 事件 trace（预览有截断）",
    "/debug on|terminal|file|off|status": "全量 compose / llm / tool 输出（无截断）",
  },
};
