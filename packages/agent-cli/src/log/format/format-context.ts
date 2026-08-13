import chalk from "chalk";

import { contextCopy, fmtNum } from "../../i18n/context/index.js";
import type { ContextReport } from "@moontide/agent";
import type { AgentEvent } from "@moontide/agent/observability";
import { formatPluginErrorEvent } from "./format-error.js";

const theme = {
	border: chalk.cyan.dim,
};

type ContextKindFormatter = (
	event: AgentEvent,
	report: ContextReport,
) => string | null;

function formatMetricsKind(
	_event: AgentEvent,
	_report: ContextReport,
	_phase?: "pre" | "post",
): string | null {
	return null;
}

const CONTEXT_KIND_FORMATTERS: Record<string, ContextKindFormatter> = {
	context_metrics: (event, report) => formatMetricsKind(event, report),
	metrics_pre: (event, report) => formatMetricsKind(event, report, "pre"),
	metrics_post: (event, report) => formatMetricsKind(event, report, "post"),
};

export function formatContextEvent(event: AgentEvent): string | null {
	if (event.kind === "plugin_error") {
		return formatPluginErrorEvent(event);
	}

	if (event.kind === "context_compact") {
		const copy = contextCopy();
		const before = fmtNum(Number(event.payload.beforeTokens ?? 0));
		const after = fmtNum(Number(event.payload.afterTokens ?? 0));
		const saved = fmtNum(
			Number(event.payload.beforeTokens ?? 0) -
				Number(event.payload.afterTokens ?? 0),
		);
		const mode = String(event.payload.mode ?? "prune");
		return theme.border(copy.compact(mode, before, after, saved));
	}

	const report = event.payload.report as ContextReport | undefined;
	if (!report) {
		return null;
	}

	const formatter = CONTEXT_KIND_FORMATTERS[event.kind];
	return formatter?.(event, report) ?? null;
}
