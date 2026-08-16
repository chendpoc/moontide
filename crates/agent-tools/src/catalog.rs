use agent_core::tools::Tool;
use anyhow::{bail, Context, Result};

use crate::grep;

type ToolBuilder = fn() -> Result<Tool>;

/// Static catalog entry that can build one first-party runtime tool.
pub struct ToolDefinition {
    name: &'static str,
    builder: ToolBuilder,
}

impl ToolDefinition {
    pub(crate) const fn new(name: &'static str, builder: ToolBuilder) -> Self {
        Self { name, builder }
    }

    pub fn name(&self) -> &'static str {
        self.name
    }

    pub fn build(&self) -> Result<Tool> {
        let tool = (self.builder)()
            .with_context(|| format!("failed to build builtin tool {}", self.name))?;
        if tool.spec().name() != self.name {
            bail!(
                "tool definition name mismatch: expected {}, built {}",
                self.name,
                tool.spec().name()
            );
        }
        Ok(tool)
    }
}

static BUILTIN_TOOL_DEFINITIONS: &[ToolDefinition] =
    &[ToolDefinition::new(grep::NAME, grep::build)];

pub fn builtin_tool_definitions() -> &'static [ToolDefinition] {
    BUILTIN_TOOL_DEFINITIONS
}
