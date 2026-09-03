use anyhow::{
    Result,
    bail,
};
use serde_json::Value;

/// Model-visible declaration of one tool capability.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolSpec {
    name: String,
    description: String,
    input_schema: Value,
}

impl ToolSpec {
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        input_schema: Value,
    ) -> Result<Self> {
        let name = name.into();
        if name.trim().is_empty() {
            bail!("tool name must not be empty");
        }
        if name.len() > 64
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            bail!("tool name must match ^[A-Za-z0-9_-]{{1,64}}$");
        }

        Ok(Self {
            name,
            description: description.into(),
            input_schema,
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    pub fn input_schema(&self) -> &Value {
        &self.input_schema
    }
}
