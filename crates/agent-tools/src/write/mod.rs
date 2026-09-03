mod executor;
mod spec;

use std::sync::Arc;

use agent_core::tools::Tool;
use anyhow::Result;
pub(crate) use executor::WriteExecutor;

pub(crate) const NAME: &str = "write";

pub(crate) fn build() -> Result<Tool> {
    Ok(Tool::new(spec::build()?, Arc::new(WriteExecutor)))
}
