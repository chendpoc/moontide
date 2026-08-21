mod aggregator;
mod executor;
mod model;
mod providers;
mod spec;

use std::{sync::Arc, time::Duration};

use agent_core::tools::Tool;
use anyhow::{Context, Result};

pub(crate) use executor::WebSearchExecutor;

pub(crate) const NAME: &str = "web_search";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) fn build() -> Result<Tool> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .context("build web_search HTTP client")?;

    let mut providers: Vec<Box<dyn model::SearchProvider>> =
        vec![Box::new(providers::DuckDuckGoProvider::new(client.clone()))];
    if let Some(searxng) = providers::SearxngProvider::from_environment(client) {
        providers.push(Box::new(searxng));
    }

    Ok(Tool::new(
        spec::build()?,
        Arc::new(WebSearchExecutor::new(aggregator::SearchAggregator::new(
            providers,
        ))),
    ))
}
