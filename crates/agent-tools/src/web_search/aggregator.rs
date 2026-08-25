use std::collections::HashSet;

use super::model::{ProviderError, SearchProvider, SearchRequest, SearchResult};

pub(crate) struct SearchAggregator {
    providers: Vec<Box<dyn SearchProvider>>,
}

#[derive(Debug)]
pub(crate) struct SearchResponse {
    pub(crate) results: Vec<SearchResult>,
    pub(crate) warnings: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct SearchError {
    pub(crate) message: String,
    pub(crate) retryable: bool,
}

impl SearchAggregator {
    pub(crate) fn new(providers: Vec<Box<dyn SearchProvider>>) -> Self {
        Self { providers }
    }

    pub(crate) async fn search(
        &self,
        request: &SearchRequest,
    ) -> Result<SearchResponse, SearchError> {
        let mut results = Vec::new();
        let mut warnings = Vec::new();
        let mut successful_providers = 0;
        let mut retryable_failure = false;

        for provider in &self.providers {
            match provider.search(request).await {
                Ok(provider_results) => {
                    successful_providers += 1;
                    results.extend(provider_results);
                }
                Err(error) => {
                    retryable_failure |= error.retryable;
                    warnings.push(format_provider_warning(&error));
                }
            }
        }

        if successful_providers == 0 {
            return Err(SearchError {
                message: if warnings.is_empty() {
                    "no web search provider is configured".to_owned()
                } else {
                    format!("all web search providers failed: {}", warnings.join("; "))
                },
                retryable: retryable_failure,
            });
        }

        Ok(SearchResponse {
            results: deduplicate_results(results, request.max_results),
            warnings,
        })
    }
}

fn format_provider_warning(error: &ProviderError) -> String {
    format!("{} provider unavailable: {}", error.provider, error.message)
}

fn deduplicate_results(results: Vec<SearchResult>, max_results: usize) -> Vec<SearchResult> {
    let mut seen = HashSet::new();
    let mut deduplicated = Vec::new();

    for mut result in results {
        let Some(canonical_url) = canonical_url(&result.url) else {
            continue;
        };
        if !seen.insert(canonical_url.clone()) {
            continue;
        }
        result.url = canonical_url;
        deduplicated.push(result);
        if deduplicated.len() >= max_results {
            break;
        }
    }

    deduplicated
}

fn canonical_url(value: &str) -> Option<String> {
    let mut url = reqwest::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    url.set_fragment(None);
    if matches!(url.scheme(), "http" | "https") && url.port_or_known_default().is_some() {
        if url.port_or_known_default() == Some(80)
            && url.scheme() == "http"
            && url.set_port(None).is_err()
        {
            return None;
        }
        if url.port_or_known_default() == Some(443)
            && url.scheme() == "https"
            && url.set_port(None).is_err()
        {
            return None;
        }
    }
    let path = url.path().trim_end_matches('/').to_owned();
    if path.is_empty() {
        url.set_path("/");
    } else {
        url.set_path(&path);
    }
    Some(url.to_string())
}

#[cfg(test)]
mod tests {
    use anyhow::{ensure, Result};

    use super::{canonical_url, SearchAggregator};
    use crate::web_search::model::{
        ProviderError, ProviderFuture, SearchProvider, SearchProviderId, SearchRequest,
        SearchResult,
    };

    struct StubProvider {
        id: SearchProviderId,
        response: Option<Result<Vec<SearchResult>, ProviderError>>,
    }

    impl SearchProvider for StubProvider {
        fn id(&self) -> SearchProviderId {
            self.id
        }

        fn search<'a>(&'a self, _request: &'a SearchRequest) -> ProviderFuture<'a> {
            let response = self.response.as_ref().map(|result| match result {
                Ok(results) => Ok(results.clone()),
                Err(error) => Err(ProviderError::new(
                    error.provider,
                    error.message.clone(),
                    error.retryable,
                )),
            });
            Box::pin(async move {
                match response {
                    Some(response) => response,
                    None => Ok(Vec::new()),
                }
            })
        }
    }

    fn result(provider: SearchProviderId, url: &str) -> SearchResult {
        SearchResult {
            provider,
            title: "title".to_owned(),
            url: url.to_owned(),
            snippet: "snippet".to_owned(),
        }
    }

    // 测试场景：两个 provider 返回相同 URL 的结果；预期按固定 provider 顺序保留第一条并去掉 fragment/默认端口差异；不变量/副作用：聚合结果稳定且不重复。
    #[tokio::test]
    async fn aggregates_and_deduplicates_results() -> Result<()> {
        let aggregator = SearchAggregator::new(vec![
            Box::new(StubProvider {
                id: SearchProviderId::DuckDuckGo,
                response: Some(Ok(vec![result(
                    SearchProviderId::DuckDuckGo,
                    "https://example.com:443/doc#one",
                )])),
            }),
            Box::new(StubProvider {
                id: SearchProviderId::Searxng,
                response: Some(Ok(vec![result(
                    SearchProviderId::Searxng,
                    "https://example.com/doc#two",
                )])),
            }),
        ]);
        let response = aggregator
            .search(&SearchRequest {
                query: "rust".to_owned(),
                max_results: 5,
            })
            .await
            .map_err(|error| anyhow::anyhow!(error.message))?;
        ensure!(response.results.len() == 1);
        ensure!(response.results[0].provider == SearchProviderId::DuckDuckGo);
        ensure!(response.results[0].url == "https://example.com/doc");
        Ok(())
    }

    // 测试场景：第一个 provider 失败、第二个 provider 成功；预期返回成功结果并附 provider warning；不变量/副作用：单个 provider 故障不阻断聚合。
    #[tokio::test]
    async fn isolates_provider_failure_when_another_succeeds() -> Result<()> {
        let aggregator = SearchAggregator::new(vec![
            Box::new(StubProvider {
                id: SearchProviderId::DuckDuckGo,
                response: Some(Err(ProviderError::new(
                    SearchProviderId::DuckDuckGo,
                    "HTTP 503",
                    true,
                ))),
            }),
            Box::new(StubProvider {
                id: SearchProviderId::Searxng,
                response: Some(Ok(vec![result(
                    SearchProviderId::Searxng,
                    "https://example.com",
                )])),
            }),
        ]);
        let response = aggregator
            .search(&SearchRequest {
                query: "rust".to_owned(),
                max_results: 5,
            })
            .await
            .map_err(|error| anyhow::anyhow!(error.message))?;
        ensure!(response.results.len() == 1);
        ensure!(response.warnings.len() == 1);
        Ok(())
    }

    // 测试场景：所有 provider 均失败，其中一个错误可重试；预期 aggregator 返回 retryable=true 的失败；不变量/副作用：不能把全失败伪装为空成功。
    #[tokio::test]
    async fn aggregates_all_provider_failures() -> Result<()> {
        let aggregator = SearchAggregator::new(vec![
            Box::new(StubProvider {
                id: SearchProviderId::DuckDuckGo,
                response: Some(Err(ProviderError::new(
                    SearchProviderId::DuckDuckGo,
                    "timeout",
                    true,
                ))),
            }),
            Box::new(StubProvider {
                id: SearchProviderId::Searxng,
                response: Some(Err(ProviderError::new(
                    SearchProviderId::Searxng,
                    "invalid configuration",
                    false,
                ))),
            }),
        ]);
        let error = aggregator
            .search(&SearchRequest {
                query: "rust".to_owned(),
                max_results: 5,
            })
            .await
            .expect_err("all provider failures must fail");
        ensure!(error.retryable);
        Ok(())
    }

    // 测试场景：URL 包含 fragment、默认端口和 trailing slash；预期 canonical URL 可用于稳定去重；不变量/副作用：非 HTTP(S) URL 被拒绝。
    #[test]
    fn canonicalizes_http_urls() {
        assert_eq!(
            canonical_url("https://example.com:443/path/#fragment").as_deref(),
            Some("https://example.com/path")
        );
        assert!(canonical_url("javascript:alert(1)").is_none());
    }
}
