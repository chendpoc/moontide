use std::{future::Future, path::Path, pin::Pin, sync::Arc};

use agent_core::tools::{ToolCall, ToolContent, ToolExecutor, ToolResult};
use anyhow::{Context, Result};
use serde::Deserialize;

use crate::workspace::{
    truncate_from_start, DEFAULT_MAX_LINES, MAX_OUTPUT_BYTES, OUTPUT_LIMIT_MARKER,
};

use super::{aggregator::SearchAggregator, model::SearchRequest};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WebSearchInput {
    query: String,
    #[serde(default = "super::model::default_max_results")]
    max_results: usize,
}

pub(crate) struct WebSearchExecutor {
    aggregator: Arc<SearchAggregator>,
}

impl WebSearchExecutor {
    pub(crate) fn new(aggregator: SearchAggregator) -> Self {
        Self {
            aggregator: Arc::new(aggregator),
        }
    }
}

impl ToolExecutor for WebSearchExecutor {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        _working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolResult>> + Send + 'a>> {
        Box::pin(async move {
            let input = serde_json::from_value::<WebSearchInput>(call.input().clone())
                .context("web_search input no longer matches its schema")?;
            let request = SearchRequest {
                query: input.query,
                max_results: input.max_results,
            };
            match self.aggregator.search(&request).await {
                Ok(response) => Ok(format_results(call, response.results, response.warnings)),
                Err(error) => Ok(ToolResult::failed(
                    call,
                    ToolContent::Text(format!("web_search failed: {}", error.message)),
                    error.retryable,
                )),
            }
        })
    }
}

fn format_results(
    call: &ToolCall,
    results: Vec<super::model::SearchResult>,
    warnings: Vec<String>,
) -> ToolResult {
    if results.is_empty() {
        let text = if warnings.is_empty() {
            "No results found.".to_owned()
        } else {
            format!("No results found.\nWarnings: {}", warnings.join("; "))
        };
        return ToolResult::succeeded(call, ToolContent::Text(text));
    }

    let mut text = String::new();
    for (index, result) in results.into_iter().enumerate() {
        if index > 0 {
            text.push('\n');
        }
        text.push_str(&format!(
            "{}. {}\nProvider: {}\nURL: {}\n{}\n",
            index + 1,
            result.title.trim(),
            result.provider,
            result.url.trim(),
            result.snippet.trim()
        ));
    }
    if !warnings.is_empty() {
        text.push_str("\nWarnings: ");
        text.push_str(&warnings.join("; "));
    }

    let payload_budget = MAX_OUTPUT_BYTES.saturating_sub(OUTPUT_LIMIT_MARKER.len());
    ToolResult::succeeded(
        call,
        ToolContent::Text(truncate_from_start(text, DEFAULT_MAX_LINES, payload_budget)),
    )
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use agent_core::tools::{ToolCall, ToolContent, ToolExecutor, ToolResultStatus};
    use anyhow::{bail, ensure, Result};
    use serde_json::json;

    use crate::workspace::{MAX_OUTPUT_BYTES, OUTPUT_LIMIT_MARKER};

    use super::super::{aggregator::SearchAggregator, model::SearchProviderId};
    use super::{format_results, WebSearchExecutor};

    fn make_executor() -> WebSearchExecutor {
        WebSearchExecutor::new(SearchAggregator::new(Vec::new()))
    }

    fn succeeded_text(result: agent_core::tools::ToolResult) -> Result<String> {
        match (result.status(), result.content()) {
            (ToolResultStatus::Succeeded, ToolContent::Text(text)) => Ok(text.clone()),
            other => bail!("expected successful text result, got {other:?}"),
        }
    }

    // 测试场景：没有 provider 配置且输入 schema 合法；预期 executor 返回不可重试失败；不变量/副作用：不会访问网络，也不把空 provider 当成 No results found.。
    #[tokio::test]
    async fn reports_missing_provider_as_failure() -> Result<()> {
        let executor = make_executor();
        let call = ToolCall::new("call-1", super::super::NAME, json!({"query":"rust"}))?;
        let result = executor.execute(&call, Path::new(".")).await?;
        ensure!(matches!(
            result.status(),
            ToolResultStatus::Failed { retryable: false }
        ));
        Ok(())
    }

    // 测试场景：聚合器返回带来源的结果和 warning；预期文本同时保留 provider attribution 与 warning；不变量/副作用：格式化不执行 IO。
    #[test]
    fn formats_provider_attribution_and_warnings() -> Result<()> {
        let call = ToolCall::new("call-format", super::super::NAME, json!({"query":"rust"}))?;
        let text = succeeded_text(format_results(
            &call,
            vec![super::super::model::SearchResult {
                provider: SearchProviderId::DuckDuckGo,
                title: "Rust".to_owned(),
                url: "https://example.com".to_owned(),
                snippet: "language".to_owned(),
            }],
            vec!["searxng provider unavailable: HTTP 503".to_owned()],
        ))?;
        ensure!(text.contains("Provider: duckduckgo"));
        ensure!(text.contains("Warnings: searxng provider unavailable: HTTP 503"));
        Ok(())
    }

    // 测试场景：搜索结果文本超过 32 KiB；预期最终 ToolContent 连同截断标记不超过硬上限；不变量/副作用：截断保持 UTF-8 且不 panic。
    #[test]
    fn bounds_formatted_output() -> Result<()> {
        let call = ToolCall::new("call-limit", super::super::NAME, json!({"query":"rust"}))?;
        let output = format_results(
            &call,
            vec![super::super::model::SearchResult {
                provider: SearchProviderId::DuckDuckGo,
                title: "Long".to_owned(),
                url: "https://example.com".to_owned(),
                snippet: "a".repeat(MAX_OUTPUT_BYTES + 128),
            }],
            Vec::new(),
        );
        let text = succeeded_text(output)?;
        ensure!(text.ends_with(OUTPUT_LIMIT_MARKER));
        ensure!(text.len() <= MAX_OUTPUT_BYTES);
        Ok(())
    }
}
