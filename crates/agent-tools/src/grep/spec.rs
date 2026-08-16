use agent_core::tools::ToolSpec;
use anyhow::Result;
use serde_json::json;

pub(super) fn build() -> Result<ToolSpec> {
    ToolSpec::new(
        super::NAME,
        "Search UTF-8 text lines inside the working directory with a Rust regular expression.",
        json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Rust regular expression matched against each text line."
                },
                "path": {
                    "type": "string",
                    "minLength": 1,
                    "default": ".",
                    "description": "File or directory below the working directory."
                },
                "max_results": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1000,
                    "default": 100,
                    "description": "Maximum number of matching lines to return."
                }
            },
            "required": ["pattern"],
            "additionalProperties": false
        }),
    )
}
