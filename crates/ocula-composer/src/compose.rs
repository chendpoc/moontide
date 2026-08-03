use ocula_protocol::{Message, ToolSchema};
use ocula_tools::tool_definitions;

#[derive(Debug, Clone)]
pub struct ComposedLlmRequest {
    pub system: String,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolSchema>,
}

pub fn compose_context_v1(system: String, messages: Vec<Message>) -> ComposedLlmRequest {
    let mut tools = tool_definitions();
    tools.sort_by(|a, b| a.name.cmp(&b.name));
    ComposedLlmRequest {
        system,
        messages,
        tools,
    }
}
