use std::future::Future;
use std::path::Path;
use std::pin::Pin;

use anyhow::Result;

use super::{
    ToolCall,
    ToolResult,
};

/// Side-effect boundary implemented by each concrete tool.
pub trait ToolExecutor: Send + Sync {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolResult>> + Send + 'a>>;
}
