use std::{future::Future, path::Path, pin::Pin, sync::Arc};

use anyhow::Result;
use serde_json::{json, Value};

use crate::{
    llm::protocol::{Message, MessageContent, Role, ThinkingLevel},
    tools::{Tool, ToolCall, ToolExecutor, ToolRegistry, ToolResult, ToolSpec},
};

use super::{compile, ModelRequestConfig, SystemPrompt};

struct NoopExecutor;

impl ToolExecutor for NoopExecutor {
    fn execute<'a>(
        &'a self,
        _call: &'a ToolCall,
        _working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolResult>> + Send + 'a>> {
        Box::pin(async { Err(anyhow::anyhow!("model_input test executor must not run")) })
    }
}

fn schema(property: &str) -> Value {
    json!({
        "type": "object",
        "properties": {
            property: { "type": "string" }
        },
        "additionalProperties": false
    })
}

fn registry(specs: Vec<ToolSpec>) -> Result<ToolRegistry> {
    ToolRegistry::new(
        specs
            .into_iter()
            .map(|spec| Tool::new(spec, Arc::new(NoopExecutor)))
            .collect(),
    )
}

// 场景：使用完整配置、system prompt、消息历史和乱序工具 registry 编译请求；预期：所有字段完整映射，messages 原顺序保留，tool schema 按 registry 顺序输出；不变量/副作用：compile 不执行任何 tool IO。
#[test]
fn compile_maps_all_resolved_inputs_without_side_effects() -> Result<()> {
    let read_schema = schema("path");
    let write_schema = schema("content");
    let tools = registry(vec![
        ToolSpec::new("write_file", "write a file", write_schema.clone())?,
        ToolSpec::new("read_file", "read a file", read_schema.clone())?,
    ])?;
    let messages = vec![
        Message {
            role: Role::User,
            content: MessageContent::Text("read README.md".into()),
        },
        Message {
            role: Role::Assistant,
            content: MessageContent::Text("I will inspect it.".into()),
        },
    ];
    let config = ModelRequestConfig {
        model: "deepseek-chat".into(),
        max_tokens: 2048,
        thinking_level: Some(ThinkingLevel::Low),
        session_id: Some("session-1".into()),
    };
    let system_prompt = SystemPrompt::new("You are MoonTide.");

    let request = compile(&config, &system_prompt, messages.clone(), &tools);

    assert_eq!(request.model, "deepseek-chat");
    assert_eq!(request.system, "You are MoonTide.");
    assert_eq!(request.messages, messages);
    assert_eq!(request.max_tokens, 2048);
    assert_eq!(request.thinking_level, Some(ThinkingLevel::Low));
    assert_eq!(request.session_id.as_deref(), Some("session-1"));
    assert_eq!(request.tools.len(), 2);
    assert_eq!(request.tools[0].name, "read_file");
    assert_eq!(request.tools[0].description, "read a file");
    assert_eq!(request.tools[0].input_schema, read_schema);
    assert_eq!(request.tools[1].name, "write_file");
    assert_eq!(request.tools[1].description, "write a file");
    assert_eq!(request.tools[1].input_schema, write_schema);
    Ok(())
}

// 场景：编译空 system、空 registry、空 model、空 messages 和零 max_tokens；预期：compile 仍返回结构完整的 ModelRequest；不变量/副作用：model request preflight 由 llm 负责，model_input 不复制校验、不 panic。
#[test]
fn compile_preserves_empty_and_invalid_preflight_inputs() -> Result<()> {
    let tools = registry(Vec::new())?;
    let config = ModelRequestConfig {
        model: String::new(),
        max_tokens: 0,
        thinking_level: None,
        session_id: None,
    };

    let request = compile(
        &config,
        &SystemPrompt::new(String::new()),
        Vec::new(),
        &tools,
    );

    assert!(request.model.is_empty());
    assert!(request.system.is_empty());
    assert!(request.messages.is_empty());
    assert!(request.tools.is_empty());
    assert_eq!(request.max_tokens, 0);
    assert_eq!(request.thinking_level, None);
    assert_eq!(request.session_id, None);
    Ok(())
}

// 场景：同一 user turn 使用同一 config、system prompt 和 frozen registry 编译两个 model step；预期：稳定输入和 tool schema 相同，只有传入 messages 随 step 变化；不变量/副作用：compile 不重新解析文件、不修改 registry。
#[test]
fn compile_reuses_stable_turn_inputs_across_steps() -> Result<()> {
    let tools = registry(vec![ToolSpec::new(
        "grep",
        "search files",
        schema("pattern"),
    )?])?;
    let config = ModelRequestConfig {
        model: "deepseek-chat".into(),
        max_tokens: 1024,
        thinking_level: None,
        session_id: Some("session-1".into()),
    };
    let system_prompt = SystemPrompt::new("stable instructions");
    let first_messages = vec![Message {
        role: Role::User,
        content: MessageContent::Text("first".into()),
    }];
    let second_messages = vec![
        first_messages[0].clone(),
        Message {
            role: Role::Assistant,
            content: MessageContent::Text("tool requested".into()),
        },
    ];

    let first = compile(&config, &system_prompt, first_messages, &tools);
    let second = compile(&config, &system_prompt, second_messages.clone(), &tools);

    assert_eq!(first.model, second.model);
    assert_eq!(first.system, second.system);
    assert_eq!(first.tools[0].name, second.tools[0].name);
    assert_eq!(first.tools[0].input_schema, second.tools[0].input_schema);
    assert_eq!(first.max_tokens, second.max_tokens);
    assert_eq!(first.session_id, second.session_id);
    assert_ne!(first.messages, second.messages);
    assert_eq!(second.messages, second_messages);
    Ok(())
}
