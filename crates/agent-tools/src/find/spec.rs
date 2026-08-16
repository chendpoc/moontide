use agent_core::tools::ToolSpec;
use anyhow::Result;
use serde_json::json;

pub(super) fn build() -> Result<ToolSpec> {
    ToolSpec::new(
        super::NAME,
        "Find files by glob pattern inside the working directory without reading file contents.",
        json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Glob pattern such as **/*.rs or *.toml."
                },
                "path": {
                    "type": "string",
                    "minLength": 1,
                    "default": ".",
                    "description": "Directory below the working directory to search."
                },
                "max_results": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1000,
                    "default": 100,
                    "description": "Maximum number of paths to return."
                }
            },
            "required": ["pattern"],
            "additionalProperties": false
        }),
    )
}
