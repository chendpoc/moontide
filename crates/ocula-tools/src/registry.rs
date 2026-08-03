use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;

use ocula_protocol::ToolSchema;
use serde_json::{json, Value};

use crate::builtins;
use crate::builtins::{git, grep, shell};
use crate::names;
use crate::ToolContext;

pub type ToolHandler = fn(ToolContext, Value) -> Pin<Box<dyn Future<Output = String> + Send>>;

pub struct ToolDefinition {
    pub schema: ToolSchema,
    pub handler: ToolHandler,
}

static REGISTRY: OnceLock<HashMap<String, ToolDefinition>> = OnceLock::new();

pub fn default_tools() -> Vec<ToolDefinition> {
    registry().values().cloned().collect()
}

pub fn get_tool(name: &str) -> Option<ToolDefinition> {
    registry().get(name).cloned()
}

fn registry() -> &'static HashMap<String, ToolDefinition> {
    REGISTRY.get_or_init(|| {
        let tools = vec![
            tool(
                names::BASH,
                "Run a shell command in the workspace.",
                json!({
                    "type": "object",
                    "properties": { "command": { "type": "string" } },
                    "required": ["command"]
                }),
                |ctx, input| {
                    let workdir = ctx.workdir;
                    Box::pin(async move {
                        shell::run_bash(&workdir, input["command"].as_str().unwrap_or("")).await
                    })
                },
            ),
            tool(
                names::READ_FILE,
                "Read a file relative to the workspace.",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "limit": { "type": "integer" },
                        "offset": { "type": "integer" }
                    },
                    "required": ["path"]
                }),
                |ctx, input| {
                    let workdir = ctx.workdir;
                    Box::pin(async move {
                        let limit = input.get("limit").and_then(|v| v.as_u64()).map(|v| v as u32);
                        let offset = input.get("offset").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
                        builtins::run_read(
                            &workdir,
                            input["path"].as_str().unwrap_or(""),
                            limit,
                            offset,
                        )
                    })
                },
            ),
            tool(
                names::WRITE_FILE,
                "Write content to a file relative to the workspace.",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "content": { "type": "string" }
                    },
                    "required": ["path", "content"]
                }),
                |ctx, input| {
                    let workdir = ctx.workdir;
                    Box::pin(async move {
                        builtins::run_write(
                            &workdir,
                            input["path"].as_str().unwrap_or(""),
                            input["content"].as_str().unwrap_or(""),
                        )
                    })
                },
            ),
            tool(
                names::EDIT_FILE,
                "Replace the first exact occurrence of old_text in a file.",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "old_text": { "type": "string" },
                        "new_text": { "type": "string" }
                    },
                    "required": ["path", "old_text", "new_text"]
                }),
                |ctx, input| {
                    let workdir = ctx.workdir;
                    Box::pin(async move {
                        builtins::run_edit(
                            &workdir,
                            input["path"].as_str().unwrap_or(""),
                            input["old_text"].as_str().unwrap_or(""),
                            input["new_text"].as_str().unwrap_or(""),
                        )
                    })
                },
            ),
            tool(
                names::GLOB,
                "Find files matching a glob pattern in the workspace.",
                json!({
                    "type": "object",
                    "properties": { "pattern": { "type": "string" } },
                    "required": ["pattern"]
                }),
                |ctx, input| {
                    let workdir = ctx.workdir;
                    Box::pin(async move {
                        builtins::run_glob(&workdir, input["pattern"].as_str().unwrap_or(""))
                    })
                },
            ),
            tool(
                names::LIST_DIR,
                "List files and directories under a workspace path.",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "recursive": { "type": "boolean" }
                    }
                }),
                |ctx, input| {
                    let workdir = ctx.workdir;
                    Box::pin(async move {
                        builtins::run_list_dir(
                            &workdir,
                            input.get("path").and_then(|v| v.as_str()).unwrap_or("."),
                            input.get("recursive").and_then(|v| v.as_bool()).unwrap_or(false),
                        )
                    })
                },
            ),
            tool(
                names::GREP,
                "Search code in the workspace with ripgrep or grep.",
                json!({
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string" },
                        "path": { "type": "string" },
                        "glob": { "type": "string" },
                        "max_results": { "type": "integer" },
                        "case_insensitive": { "type": "boolean" }
                    },
                    "required": ["pattern"]
                }),
                |ctx, input| {
                    let workdir = ctx.workdir;
                    Box::pin(async move {
                        grep::run_grep(
                            &workdir,
                            input["pattern"].as_str().unwrap_or(""),
                            input.get("path").and_then(|v| v.as_str()),
                            input.get("glob").and_then(|v| v.as_str()),
                            input.get("max_results").and_then(|v| v.as_u64()).map(|v| v as u32),
                            input
                                .get("case_insensitive")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false),
                        )
                        .await
                    })
                },
            ),
            tool(
                names::GIT_STATUS,
                "Read-only git status for the workspace.",
                json!({ "type": "object", "properties": {} }),
                |ctx, _| {
                    let workdir = ctx.workdir;
                    Box::pin(async move { git::run_git_status(&workdir).await })
                },
            ),
            tool(
                names::GIT_DIFF,
                "Read-only git diff (default --stat).",
                json!({
                    "type": "object",
                    "properties": {
                        "stat": { "type": "boolean" },
                        "path": { "type": "string" },
                        "staged": { "type": "boolean" }
                    }
                }),
                |ctx, input| {
                    let workdir = ctx.workdir;
                    Box::pin(async move {
                        git::run_git_diff(
                            &workdir,
                            input.get("stat").and_then(|v| v.as_bool()).unwrap_or(true),
                            input.get("path").and_then(|v| v.as_str()),
                            input.get("staged").and_then(|v| v.as_bool()).unwrap_or(false),
                        )
                        .await
                    })
                },
            ),
            tool(
                names::GIT_LOG,
                "Read-only git log (oneline).",
                json!({
                    "type": "object",
                    "properties": {
                        "n": { "type": "integer" },
                        "path": { "type": "string" }
                    }
                }),
                |ctx, input| {
                    let workdir = ctx.workdir;
                    Box::pin(async move {
                        git::run_git_log(
                            &workdir,
                            input.get("n").and_then(|v| v.as_u64()).unwrap_or(10) as u32,
                            input.get("path").and_then(|v| v.as_str()),
                        )
                        .await
                    })
                },
            ),
            tool(
                names::GIT_SUMMARY,
                "Combined git overview (returns code_repl template hint).",
                json!({
                    "type": "object",
                    "properties": { "log_n": { "type": "integer" } }
                }),
                |_ctx, input| {
                    Box::pin(async move {
                        git::run_git_summary_link(
                            input.get("log_n").and_then(|v| v.as_u64()).map(|v| v as u32),
                        )
                    })
                },
            ),
        ];

        tools
            .into_iter()
            .map(|t| (t.schema.name.clone(), t))
            .collect()
    })
}

fn tool(
    name: &str,
    description: &str,
    input_schema: Value,
    handler: ToolHandler,
) -> ToolDefinition {
    ToolDefinition {
        schema: ToolSchema {
            name: name.into(),
            description: description.into(),
            input_schema,
        },
        handler,
    }
}

impl Clone for ToolDefinition {
    fn clone(&self) -> Self {
        Self {
            schema: self.schema.clone(),
            handler: self.handler,
        }
    }
}
