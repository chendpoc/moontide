use std::{path::Path, sync::Arc};

use anyhow::{bail, Context, Result};
use jsonschema::Validator;

use super::{
    validate::compile_input_validator, ToolCall, ToolExecutor, ToolResult, ToolResultStatus,
    ToolSpec,
};

/// Runtime binding between one model-visible declaration and its executor.
pub struct Tool {
    spec: ToolSpec,
    #[allow(
        dead_code,
        reason = "the loop implementation will call the executor in a later review batch"
    )]
    executor: Arc<dyn ToolExecutor>,
}

impl Tool {
    pub fn new(spec: ToolSpec, executor: Arc<dyn ToolExecutor>) -> Self {
        Self { spec, executor }
    }

    pub fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    #[allow(
        dead_code,
        reason = "the loop implementation will call this internal boundary in a later review batch"
    )]
    pub(crate) async fn execute(&self, call: &ToolCall, working_dir: &Path) -> Result<ToolResult> {
        let result = self.executor.execute(call, working_dir).await?;
        if result.tool_use_id() != call.tool_use_id() || result.name() != call.name() {
            bail!(
                "tool executor result identity mismatch: expected {}/{}, got {}/{}",
                call.name(),
                call.tool_use_id(),
                result.name(),
                result.tool_use_id()
            );
        }
        if !matches!(
            result.status(),
            ToolResultStatus::Succeeded
                | ToolResultStatus::Failed { .. }
                | ToolResultStatus::OutcomeUnknown
        ) {
            bail!(
                "tool executor returned pipeline-owned status: {:?}",
                result.status()
            );
        }
        Ok(result)
    }
}

/// Immutable, name-sorted tool collection with precompiled input validators.
pub struct ToolRegistry {
    tools: Vec<Tool>,
    #[allow(
        dead_code,
        reason = "the loop implementation will validate calls in a later review batch"
    )]
    validators: Vec<Validator>,
}

impl ToolRegistry {
    pub fn new(mut tools: Vec<Tool>) -> Result<Self> {
        tools.sort_by(|left, right| left.spec().name().cmp(right.spec().name()));

        if let Some(duplicate) = tools
            .windows(2)
            .find(|pair| pair[0].spec().name() == pair[1].spec().name())
        {
            bail!("duplicate tool name: {}", duplicate[0].spec().name());
        }

        let validators = tools
            .iter()
            .map(|tool| {
                compile_input_validator(tool.spec()).with_context(|| {
                    format!("invalid input schema for tool {}", tool.spec().name())
                })
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(Self { tools, validators })
    }

    pub fn resolve(&self, name: &str) -> Option<&Tool> {
        self.tools
            .binary_search_by(|tool| tool.spec().name().cmp(name))
            .ok()
            .map(|index| &self.tools[index])
    }

    pub fn iter(&self) -> std::slice::Iter<'_, Tool> {
        self.tools.iter()
    }

    #[allow(
        dead_code,
        reason = "the loop implementation will call this internal boundary in a later review batch"
    )]
    pub(crate) fn validate_input(&self, tool: &Tool, call: &ToolCall) -> Result<(), String> {
        let index = self
            .tools
            .binary_search_by(|candidate| candidate.spec().name().cmp(tool.spec().name()))
            .map_err(|_| {
                format!(
                    "tool {} does not belong to this registry",
                    tool.spec().name()
                )
            })?;

        self.validators[index]
            .validate(call.input())
            .map_err(|error| error.to_string())
    }
}
