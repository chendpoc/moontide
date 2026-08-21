use agent_core::tools::ToolSpec;
use anyhow::Result;
use serde_json::json;

pub(super) fn build() -> Result<ToolSpec> {
    ToolSpec::new(
        super::NAME,
        "Search the web with a query and return the top results with title, URL and content snippet.",
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Search query sent to the web search provider."
                },
                "max_results": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "default": 5,
                    "description": "Maximum number of search results to return."
                }
            },
            "required": ["query"],
            "additionalProperties": false
        }),
    )
}
