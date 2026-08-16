use std::{future::Future, path::Path, pin::Pin};

use anyhow::Result;

use super::{ToolCall, ToolOutput};

/// Side-effect boundary implemented by each concrete tool.
pub trait ToolExecutor: Send + Sync {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolOutput>> + Send + 'a>>;
}
