use reqwest::header::{ACCEPT, USER_AGENT};
use scraper::{Html, Selector};

use super::super::model::{
    ProviderError, ProviderFuture, SearchProvider, SearchProviderId, SearchRequest, SearchResult,
};

const SEARCH_URL: &str = "https://html.duckduckgo.com/html/";
const USER_AGENT_VALUE: &str = "Mozilla/5.0 (compatible; MoonTide/0.1; web_search)";

pub(crate) struct DuckDuckGoProvider {
    client: reqwest::Client,
    endpoint: String,
}

impl DuckDuckGoProvider {
    pub(crate) fn new(client: reqwest::Client) -> Self {
        Self {
            client,
            endpoint: SEARCH_URL.to_owned(),
        }
    }

    #[cfg(test)]
    fn with_endpoint(client: reqwest::Client, endpoint: String) -> Self {
        Self { client, endpoint }
    }
}

impl SearchProvider for DuckDuckGoProvider {
    fn id(&self) -> SearchProviderId {
        SearchProviderId::DuckDuckGo
    }

    fn search<'a>(&'a self, request: &'a SearchRequest) -> ProviderFuture<'a> {
        Box::pin(async move {
            let response = self
                .client
                .get(&self.endpoint)
                .query(&[("q", request.query.as_str())])
                .header(ACCEPT, "text/html")
                .header(USER_AGENT, USER_AGENT_VALUE)
                .send()
                .await
                .map_err(|error| ProviderError::new(self.id(), error.to_string(), true))?;

            let status = response.status();
            if !status.is_success() {
                return Err(ProviderError::new(
                    self.id(),
                    format!("DuckDuckGo returned HTTP {status}"),
                    retryable_status(status),
                ));
            }

            let body = response
                .text()
                .await
                .map_err(|error| ProviderError::new(self.id(), error.to_string(), true))?;

            parse_results(&body)
        })
    }
}

fn parse_results(body: &str) -> Result<Vec<SearchResult>, ProviderError> {
    let result_selector = Selector::parse(".result").map_err(|error| {
        ProviderError::new(SearchProviderId::DuckDuckGo, error.to_string(), false)
    })?;
    let title_selector = Selector::parse(".result__a").map_err(|error| {
        ProviderError::new(SearchProviderId::DuckDuckGo, error.to_string(), false)
    })?;
    let snippet_selector = Selector::parse(".result__snippet").map_err(|error| {
        ProviderError::new(SearchProviderId::DuckDuckGo, error.to_string(), false)
    })?;

    let document = Html::parse_document(body);
    let mut results = Vec::new();
    for result in document.select(&result_selector) {
        let Some(title) = result.select(&title_selector).next() else {
            continue;
        };
        let Some(href) = title.value().attr("href") else {
            continue;
        };
        let Some(url) = decode_result_url(href) else {
            continue;
        };

        results.push(SearchResult {
            provider: SearchProviderId::DuckDuckGo,
            title: element_text(&title),
            url,
            snippet: result
                .select(&snippet_selector)
                .next()
                .map(|element| element_text(&element))
                .unwrap_or_default(),
        });
    }

    Ok(results)
}

fn element_text(element: &scraper::ElementRef<'_>) -> String {
    element.text().collect::<Vec<_>>().join(" ")
}

fn decode_result_url(href: &str) -> Option<String> {
    let link = match reqwest::Url::parse(href) {
        Ok(link) => link,
        Err(_) => reqwest::Url::parse(SEARCH_URL).ok()?.join(href).ok()?,
    };
    let destination = link
        .query_pairs()
        .find(|(key, _)| key == "uddg")
        .map(|(_, value)| value.into_owned())
        .unwrap_or_else(|| link.to_string());
    let destination = reqwest::Url::parse(&destination).ok()?;
    match destination.scheme() {
        "http" | "https" => Some(destination.to_string()),
        _ => None,
    }
}

fn retryable_status(status: reqwest::StatusCode) -> bool {
    status.is_server_error()
        || status == reqwest::StatusCode::REQUEST_TIMEOUT
        || status == reqwest::StatusCode::TOO_MANY_REQUESTS
}

#[cfg(test)]
mod tests {
    use anyhow::{ensure, Result};
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::DuckDuckGoProvider;
    use super::{decode_result_url, parse_results};
    use crate::web_search::model::{SearchProvider, SearchProviderId, SearchRequest};

    // 测试场景：DuckDuckGo HTML 包含 redirect wrapper、title 和 snippet；预期解析为 destination URL 与可见文本；不变量/副作用：只解析传入字符串，不发真实网络请求。
    #[test]
    fn parses_html_results_and_decodes_redirect_url() -> Result<()> {
        let body = r#"
            <div class="result">
              <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc%23part">Example title</a>
              <a class="result__snippet">Example snippet</a>
            </div>
        "#;

        let results = parse_results(body).map_err(|error| anyhow::anyhow!(error.message))?;
        ensure!(results.len() == 1);
        ensure!(results[0].provider == SearchProviderId::DuckDuckGo);
        ensure!(results[0].url == "https://example.com/doc#part");
        ensure!(results[0].title.contains("Example title"));
        ensure!(results[0].snippet.contains("Example snippet"));
        Ok(())
    }

    // 测试场景：DuckDuckGo wrapper 指向非 HTTP(S) scheme；预期结果被拒绝；不变量/副作用：解析器不得把 javascript 或其他协议暴露给模型。
    #[test]
    fn rejects_non_http_result_urls() {
        assert!(
            decode_result_url("https://duckduckgo.com/l/?uddg=javascript%3Aalert(1)").is_none()
        );
    }

    // 测试场景：DuckDuckGo 返回合法但没有 result 节点的 HTML；预期 provider 成功返回空结果；不变量/副作用：空结果不是协议失败。
    #[test]
    fn accepts_empty_html_results() -> Result<()> {
        ensure!(parse_results("<html><body>No results</body></html>")?.is_empty());
        Ok(())
    }

    // 测试场景：DuckDuckGo provider 收到本地 mock HTML；预期发送 GET 查询并返回统一结果；不变量/副作用：只访问 wiremock，不访问固定真实 endpoint。
    #[tokio::test]
    async fn requests_and_parses_html_from_provider() -> Result<()> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/"))
            .and(query_param("q", "rust"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"<div class="result"><a class="result__a" href="https://example.com">Rust</a><a class="result__snippet">language</a></div>"#,
            ))
            .mount(&server)
            .await;

        let provider =
            DuckDuckGoProvider::with_endpoint(reqwest::Client::new(), format!("{}/", server.uri()));
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

    // 测试场景：DuckDuckGo provider 返回 503；预期暴露 retryable provider error；不变量/副作用：HTTP 失败不 panic，也不伪装成空结果。
    #[tokio::test]
    async fn maps_transient_http_failure() -> Result<()> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        let provider =
            DuckDuckGoProvider::with_endpoint(reqwest::Client::new(), format!("{}/", server.uri()));
        let error = provider
            .search(&SearchRequest {
                query: "rust".to_owned(),
                max_results: 5,
            })
            .await
            .expect_err("503 must fail");
        ensure!(error.retryable);
        Ok(())
    }
}
