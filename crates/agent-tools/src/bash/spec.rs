use agent_core::tools::ToolSpec;
use anyhow::Result;
use serde_json::json;

pub(super) fn build() -> Result<ToolSpec> {
    ToolSpec::new(
        super::NAME,
        "Execute a shell command in the working directory. Returns combined stdout and stderr, truncated to the last 2000 lines or 32 KiB.",
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Shell command to execute."
                },
                "timeout": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Optional timeout in seconds."
                }
            },
            "required": ["command"],
            "additionalProperties": false
        }),
    )
}
