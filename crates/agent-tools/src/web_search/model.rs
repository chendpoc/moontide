use std::fmt;
use std::future::Future;
use std::pin::Pin;

pub(crate) const DEFAULT_MAX_RESULTS: usize = 5;

pub(crate) const fn default_max_results() -> usize {
    DEFAULT_MAX_RESULTS
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SearchProviderId {
    DuckDuckGo,
    Searxng,
}

impl SearchProviderId {
    pub(crate) const fn label(self) -> &'static str {
        match self {
            Self::DuckDuckGo => "duckduckgo",
            Self::Searxng => "searxng",
        }
    }
}

impl fmt::Display for SearchProviderId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.label())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SearchRequest {
    pub(crate) query: String,
    pub(crate) max_results: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SearchResult {
    pub(crate) provider: SearchProviderId,
    pub(crate) title: String,
    pub(crate) url: String,
    pub(crate) snippet: String,
}

#[derive(Debug)]
pub(crate) struct ProviderError {
    pub(crate) provider: SearchProviderId,
    pub(crate) message: String,
    pub(crate) retryable: bool,
}

impl ProviderError {
    pub(crate) fn new(
        provider: SearchProviderId,
        message: impl Into<String>,
        retryable: bool,
    ) -> Self {
        Self {
            provider,
            message: message.into(),
            retryable,
        }
    }
}

impl fmt::Display for ProviderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ProviderError {}

pub(crate) type ProviderFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<SearchResult>, ProviderError>> + Send + 'a>>;

pub(crate) trait SearchProvider: Send + Sync {
    fn id(&self) -> SearchProviderId;

    fn search<'a>(&'a self, request: &'a SearchRequest) -> ProviderFuture<'a>;
}
