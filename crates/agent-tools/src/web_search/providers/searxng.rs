use std::env;

use reqwest::StatusCode;
use serde::Deserialize;

use super::super::model::{
    ProviderError, ProviderFuture, SearchProvider, SearchProviderId, SearchRequest, SearchResult,
};

const BASE_URL_ENV: &str = "MOONTIDE_SEARXNG_BASE_URL";

pub(crate) struct SearxngProvider {
    client: reqwest::Client,
    base_url: Result<reqwest::Url, String>,
}

impl SearxngProvider {
    fn new(client: reqwest::Client, value: String) -> Self {
        Self {
            client,
            base_url: validate_base_url(&value),
        }
    }

    pub(crate) fn from_environment(client: reqwest::Client) -> Option<Self> {
        match env::var(BASE_URL_ENV) {
            Ok(value) => Some(Self::new(client, value)),
            Err(env::VarError::NotPresent) => None,
            Err(error) => Some(Self {
                client,
                base_url: Err(format!("read {BASE_URL_ENV}: {error}")),
            }),
        }
    }
}

impl SearchProvider for SearxngProvider {
    fn id(&self) -> SearchProviderId {
        SearchProviderId::Searxng
    }

    fn search<'a>(&'a self, request: &'a SearchRequest) -> ProviderFuture<'a> {
        Box::pin(async move {
            let base_url = self
                .base_url
                .as_ref()
                .map_err(|error| ProviderError::new(self.id(), error.clone(), false))?;
            let endpoint = search_endpoint(base_url)
                .map_err(|error| ProviderError::new(self.id(), error, false))?;

            let response = self
                .client
                .get(endpoint)
                .query(&[
                    ("q", request.query.as_str()),
                    ("format", "json"),
                    ("categories", "general"),
                ])
                .header(reqwest::header::ACCEPT, "application/json")
                .send()
                .await
                .map_err(|error| ProviderError::new(self.id(), error.to_string(), true))?;

            let status = response.status();
            if !status.is_success() {
                return Err(ProviderError::new(
                    self.id(),
                    format!("SearXNG returned HTTP {status}"),
                    retryable_status(status),
                ));
            }

            let body = response
                .text()
                .await
                .map_err(|error| ProviderError::new(self.id(), error.to_string(), true))?;
            parse_response(&body)
        })
    }
}

#[derive(Deserialize)]
struct SearxngResponse {
    results: Vec<SearxngResult>,
}

#[derive(Deserialize)]
struct SearxngResult {
    title: String,
    url: String,
    #[serde(default)]
    content: String,
}

fn parse_response(body: &str) -> Result<Vec<SearchResult>, ProviderError> {
    let parsed = serde_json::from_str::<SearxngResponse>(body).map_err(|error| {
        ProviderError::new(
            SearchProviderId::Searxng,
            format!("SearXNG returned an unexpected response: {error}"),
            false,
        )
    })?;

    let mut results = Vec::new();
    for result in parsed.results {
        let Some(url) = valid_http_url(&result.url) else {
            continue;
        };
        results.push(SearchResult {
            provider: SearchProviderId::Searxng,
            title: result.title,
            url,
            snippet: result.content,
        });
    }
    Ok(results)
}

fn validate_base_url(value: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(value.trim())
        .map_err(|error| format!("invalid {BASE_URL_ENV}: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("{BASE_URL_ENV} must use http or https"));
    }
    if parsed.username() != "" || parsed.password().is_some() {
        return Err(format!("{BASE_URL_ENV} must not contain userinfo"));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(format!("{BASE_URL_ENV} must not contain query or fragment"));
    }
    Ok(parsed)
}

fn search_endpoint(base_url: &reqwest::Url) -> Result<reqwest::Url, String> {
    let mut endpoint = base_url.clone();
    let path = endpoint.path().trim_end_matches('/');
    endpoint.set_path(&format!("{path}/search"));
    Ok(endpoint)
}

fn valid_http_url(value: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(value).ok()?;
    match parsed.scheme() {
        "http" | "https" => Some(parsed.to_string()),
        _ => None,
    }
}

fn retryable_status(status: StatusCode) -> bool {
    status.is_server_error()
        || status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::TOO_MANY_REQUESTS
}

#[cfg(test)]
mod tests {
    use anyhow::{ensure, Result};
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::SearxngProvider;
    use super::{parse_response, search_endpoint, validate_base_url};
    use crate::web_search::model::{SearchProvider, SearchProviderId, SearchRequest};

    // 测试场景：SearXNG 返回标准 JSON 结果；预期转换为统一 SearchResult；不变量/副作用：只解析传入 body，不执行网络请求。
    #[test]
    fn parses_json_results() -> Result<()> {
        let body = r#"{
            "results": [
                {"title":"Rust", "url":"https://www.rust-lang.org/", "content":"Rust language"}
            ]
        }"#;
        let results = parse_response(body).map_err(|error| anyhow::anyhow!(error.message))?;
        ensure!(results.len() == 1);
        ensure!(results[0].provider == SearchProviderId::Searxng);
        ensure!(results[0].url == "https://www.rust-lang.org/");
        Ok(())
    }

    // 测试场景：SearXNG 响应缺少 results 字段；预期协议错误被报告为不可重试失败；不变量/副作用：不能把 malformed response 当成空结果成功。
    #[test]
    fn rejects_malformed_json_shape() {
        let error = parse_response("{}").expect_err("missing results must fail");
        assert!(!error.retryable);
    }

    // 测试场景：SearXNG 返回合法的空 results 数组；预期 provider 成功返回空结果；不变量/副作用：空结果不被当成 provider 故障。
    #[test]
    fn accepts_empty_json_results() -> Result<()> {
        ensure!(parse_response(r#"{"results":[]}"#)?.is_empty());
        Ok(())
    }

    // 测试场景：宿主配置包含 query、fragment 或 userinfo；预期 endpoint 配置被拒绝；不变量/副作用：模型无法借配置把请求改向任意 URL 语义。
    #[test]
    fn validates_configured_base_url() {
        assert!(validate_base_url("https://search.example/search?q=x").is_err());
        assert!(validate_base_url("https://user:pass@search.example").is_err());
        assert!(validate_base_url("ftp://search.example").is_err());
        assert!(validate_base_url("https://search.example/root").is_ok());

        let base = match validate_base_url("https://search.example/root/") {
            Ok(base) => base,
            Err(error) => panic!("valid URL unexpectedly rejected: {error}"),
        };
        let endpoint = match search_endpoint(&base) {
            Ok(endpoint) => endpoint,
            Err(error) => panic!("valid endpoint unexpectedly rejected: {error}"),
        };
        assert_eq!(endpoint.as_str(), "https://search.example/root/search");
    }

    // 测试场景：SearXNG provider 收到本地 mock JSON；预期发送 JSON search 请求并返回统一结果；不变量/副作用：只访问 wiremock，不访问配置中的真实实例。
    #[tokio::test]
    async fn requests_and_parses_json_from_provider() -> Result<()> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/search"))
            .and(query_param("q", "rust"))
            .and(query_param("format", "json"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "results": [{
                    "title": "Rust",
                    "url": "https://www.rust-lang.org/",
                    "content": "language"
                }]
            })))
            .mount(&server)
            .await;

        let provider = SearxngProvider::new(reqwest::Client::new(), server.uri());
        let results = provider
            .search(&SearchRequest {
                query: "rust".to_owned(),
                max_results: 5,
            })
            .await
            .map_err(|error| anyhow::anyhow!(error.message))?;
        ensure!(results.len() == 1);
        Ok(())
    }

    // 测试场景：SearXNG provider 返回 429；预期暴露 retryable provider error；不变量/副作用：限流失败不伪装成空结果。
    #[tokio::test]
    async fn maps_rate_limit_failure() -> Result<()> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&server)
            .await;
        let provider = SearxngProvider::new(reqwest::Client::new(), server.uri());
        let error = provider
            .search(&SearchRequest {
                query: "rust".to_owned(),
                max_results: 5,
            })
            .await
            .expect_err("429 must fail");
        ensure!(error.retryable);
        Ok(())
    }
}
