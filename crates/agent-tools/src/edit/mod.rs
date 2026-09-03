mod executor;
mod spec;

use std::sync::Arc;

use agent_core::tools::Tool;
use anyhow::Result;
pub(crate) use executor::EditExecutor;

pub(crate) const NAME: &str = "edit";

pub(crate) fn build() -> Result<Tool> {
    Ok(Tool::new(spec::build()?, Arc::new(EditExecutor)))
}
