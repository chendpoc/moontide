use agent_core::tools::ToolSpec;
use anyhow::Result;
use serde_json::json;

pub(super) fn build() -> Result<ToolSpec> {
    ToolSpec::new(
        super::NAME,
        "Write content to a file inside the working directory. Creates parent directories when needed.",
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "minLength": 1,
                    "description": "File path relative to the working directory."
                },
                "content": {
                    "type": "string",
                    "description": "UTF-8 text to write."
                }
            },
            "required": ["path", "content"],
            "additionalProperties": false
        }),
    )
}
