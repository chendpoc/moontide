use crate::{
    llm::protocol::{Message, ModelRequest, ToolSchema},
    tools::ToolRegistry,
};

use super::{ModelRequestConfig, SystemPrompt};

/// Assembles one provider-neutral model request from resolved turn inputs.
#[allow(
    dead_code,
    reason = "the loop module will call the compiler in a later review batch"
)]
pub(crate) fn compile(
    config: &ModelRequestConfig,
    system_prompt: &SystemPrompt,
    messages: Vec<Message>,
    tool_registry: &ToolRegistry,
) -> ModelRequest {
    ModelRequest {
        model: config.model.clone(),
        system: system_prompt.content().to_owned(),
        messages,
        tools: tool_registry
            .iter()
            .map(|tool| {
                let spec = tool.spec();
                ToolSchema {
                    name: spec.name().to_owned(),
                    description: spec.description().to_owned(),
                    input_schema: spec.input_schema().clone(),
                }
            })
            .collect(),
        max_tokens: config.max_tokens,
        thinking_level: config.thinking_level,
        session_id: config.session_id.clone(),
    }
}
