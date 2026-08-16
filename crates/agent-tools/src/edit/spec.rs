use agent_core::tools::ToolSpec;
use anyhow::Result;
use serde_json::json;

pub(super) fn build() -> Result<ToolSpec> {
    ToolSpec::new(
        super::NAME,
        "Edit a file using exact string replacement. Each old_string must match a unique, non-overlapping region of the original file.",
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "minLength": 1,
                    "description": "File path relative to the working directory."
                },
                "edits": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "properties": {
                            "old_string": {
                                "type": "string",
                                "description": "Exact text to replace in the original file."
                            },
                            "new_string": {
                                "type": "string",
                                "description": "Replacement text."
                            }
                        },
                        "required": ["old_string", "new_string"],
                        "additionalProperties": false
                    },
                    "description": "One or more replacements matched against the original file content."
                }
            },
            "required": ["path", "edits"],
            "additionalProperties": false
        }),
    )
}
