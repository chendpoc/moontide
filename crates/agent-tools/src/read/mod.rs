mod executor;
mod spec;

use std::sync::Arc;

use agent_core::tools::Tool;
use anyhow::Result;

pub(crate) use executor::ReadExecutor;

pub(crate) const NAME: &str = "read";

pub(crate) fn build() -> Result<Tool> {
    Ok(Tool::new(spec::build()?, Arc::new(ReadExecutor)))
}
