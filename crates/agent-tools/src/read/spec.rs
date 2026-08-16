use agent_core::tools::ToolSpec;
use anyhow::Result;
use serde_json::json;

pub(super) fn build() -> Result<ToolSpec> {
    ToolSpec::new(
        super::NAME,
        "Read a UTF-8 text file inside the working directory. Use offset/limit for large files; output is truncated to 2000 lines or 32 KiB.",
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "minLength": 1,
                    "description": "File path relative to the working directory."
                },
                "offset": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "1-indexed starting line number."
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Maximum number of lines to read."
                }
            },
            "required": ["path"],
            "additionalProperties": false
        }),
    )
}
