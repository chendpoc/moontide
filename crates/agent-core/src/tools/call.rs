use anyhow::{
    Result,
    bail,
};
use serde::{
    Deserialize,
    Serialize,
};
use serde_json::Value;

/// Provider-neutral request to execute one registered tool.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    tool_use_id: String,
    name: String,
    input: Value,
}

impl ToolCall {
    pub fn new(
        tool_use_id: impl Into<String>,
        name: impl Into<String>,
        input: Value,
    ) -> Result<Self> {
        let tool_use_id = tool_use_id.into();
        if tool_use_id.trim().is_empty() {
            bail!("tool use id must not be empty");
        }

        let name = name.into();
        if name.trim().is_empty() {
            bail!("tool call name must not be empty");
        }

        Ok(Self {
            tool_use_id,
            name,
            input,
        })
    }

    pub fn tool_use_id(&self) -> &str {
        &self.tool_use_id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn input(&self) -> &Value {
        &self.input
    }
}
