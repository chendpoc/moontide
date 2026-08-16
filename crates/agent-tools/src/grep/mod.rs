mod executor;
mod spec;

use std::sync::Arc;

use agent_core::tools::Tool;
use anyhow::Result;

use executor::GrepExecutor;

pub(crate) const NAME: &str = "grep";

pub(crate) fn build() -> Result<Tool> {
    Ok(Tool::new(spec::build()?, Arc::new(GrepExecutor)))
}
