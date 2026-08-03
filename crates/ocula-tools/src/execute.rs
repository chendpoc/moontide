use anyhow::{anyhow, Result};
use serde_json::Value;

use crate::registry::get_tool;
use crate::ToolContext;

pub async fn execute_tool(name: &str, input: Value, ctx: &ToolContext) -> Result<String> {
    let tool = get_tool(name).ok_or_else(|| anyhow!("Unknown tool: {name}"))?;
    Ok((tool.handler)(ctx.clone(), input).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::names;
    use tempfile::tempdir;

    #[tokio::test]
    async fn read_file_tool() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("hello.txt"), "world").unwrap();
        let ctx = ToolContext::new(dir.path());
        let out = execute_tool(
            names::READ_FILE,
            serde_json::json!({ "path": "hello.txt" }),
            &ctx,
        )
        .await
        .unwrap();
        assert!(out.contains("world"));
    }
}
