use std::{
    future::Future,
    path::Path,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

use anyhow::{bail, Result};
use serde_json::json;

use super::{
    Tool, ToolCall, ToolCancellationReason, ToolContent, ToolExecutor, ToolOutput, ToolRegistry,
    ToolResult, ToolResultStatus, ToolSpec,
};

struct ReturningExecutor {
    output: ToolOutput,
    call_count: Arc<AtomicUsize>,
}

impl ToolExecutor for ReturningExecutor {
    fn execute<'a>(
        &'a self,
        _call: &'a ToolCall,
        _working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolOutput>> + Send + 'a>> {
        self.call_count.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(self.output.clone()) })
    }
}

struct ContextEchoExecutor;

impl ToolExecutor for ContextEchoExecutor {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolOutput>> + Send + 'a>> {
        Box::pin(async move {
            Ok(ToolOutput::Succeeded(ToolContent::Json(json!({
                "input": call.input(),
                "working_dir": working_dir,
            }))))
        })
    }
}

struct FailingExecutor;

impl ToolExecutor for FailingExecutor {
    fn execute<'a>(
        &'a self,
        _call: &'a ToolCall,
        _working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolOutput>> + Send + 'a>> {
        Box::pin(async { Err(anyhow::anyhow!("executor transport failed")) })
    }
}

fn object_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "path": { "type": "string" }
        },
        "required": ["path"],
        "additionalProperties": false
    })
}

fn returning_tool(name: &str, output: ToolOutput, call_count: Arc<AtomicUsize>) -> Result<Tool> {
    Ok(Tool::new(
        ToolSpec::new(name, format!("execute {name}"), object_schema())?,
        Arc::new(ReturningExecutor { output, call_count }),
    ))
}

// 场景：构造正常工具声明和仅含空白的工具名；预期：正常字段原样可读、空白名被拒绝；不变量/副作用：声明构造不执行任何 IO。
#[test]
fn tool_spec_keeps_model_visible_fields_and_rejects_blank_name() -> Result<()> {
    let schema = object_schema();
    let spec = ToolSpec::new("read_file", "read a UTF-8 file", schema.clone())?;

    assert_eq!(spec.name(), "read_file");
    assert_eq!(spec.description(), "read a UTF-8 file");
    assert_eq!(spec.input_schema(), &schema);
    assert!(ToolSpec::new("  ", "invalid", json!({})).is_err());
    Ok(())
}

// 场景：构造 provider 传入的工具调用及缺失身份字段的调用；预期：合法值原样保留、空 tool_use_id 或 name 被拒绝；不变量/副作用：调用值只承载数据，不触发执行。
#[test]
fn tool_call_preserves_identity_and_rejects_blank_identity_fields() -> Result<()> {
    let input = json!({ "path": "README.md" });
    let call = ToolCall::new("call-1", "read_file", input.clone())?;

    assert_eq!(call.tool_use_id(), "call-1");
    assert_eq!(call.name(), "read_file");
    assert_eq!(call.input(), &input);
    assert!(ToolCall::new(" ", "read_file", json!({})).is_err());
    assert!(ToolCall::new("call-2", " ", json!({})).is_err());
    Ok(())
}

// 场景：用乱序工具创建注册表后按名称遍历和解析；预期：遍历顺序稳定且 resolve 返回对应绑定；不变量/副作用：查询不改变注册表，也不调用 executor。
#[test]
fn registry_sorts_tools_and_resolves_by_name_without_execution() -> Result<()> {
    let call_count = Arc::new(AtomicUsize::new(0));
    let registry = ToolRegistry::new(vec![
        returning_tool(
            "write_file",
            ToolOutput::Succeeded(ToolContent::Text("written".to_owned())),
            Arc::clone(&call_count),
        )?,
        returning_tool(
            "read_file",
            ToolOutput::Succeeded(ToolContent::Text("content".to_owned())),
            Arc::clone(&call_count),
        )?,
    ])?;

    let names = registry
        .iter()
        .map(|tool| tool.spec().name())
        .collect::<Vec<_>>();
    assert_eq!(names, vec!["read_file", "write_file"]);
    assert_eq!(
        registry.resolve("read_file").map(|tool| tool.spec().name()),
        Some("read_file")
    );
    assert!(registry.resolve("missing").is_none());
    assert_eq!(call_count.load(Ordering::SeqCst), 0);
    Ok(())
}

// 场景：两个工具使用相同名称创建注册表；预期：构造整体失败并指出重复名称；不变量/副作用：不返回部分可用注册表，也不执行任一工具。
#[test]
fn registry_rejects_duplicate_tool_names_atomically() -> Result<()> {
    let call_count = Arc::new(AtomicUsize::new(0));
    let result = ToolRegistry::new(vec![
        returning_tool(
            "read_file",
            ToolOutput::Succeeded(ToolContent::Text("one".to_owned())),
            Arc::clone(&call_count),
        )?,
        returning_tool(
            "read_file",
            ToolOutput::Succeeded(ToolContent::Text("two".to_owned())),
            Arc::clone(&call_count),
        )?,
    ]);

    let error = match result {
        Ok(_) => bail!("duplicate tool registry unexpectedly succeeded"),
        Err(error) => error,
    };
    assert!(error.to_string().contains("duplicate tool name: read_file"));
    assert_eq!(call_count.load(Ordering::SeqCst), 0);
    Ok(())
}

// 场景：工具声明包含不符合 Draft 2020-12 元 schema 的输入 schema；预期：注册表构造时立即失败并携带工具名；不变量/副作用：无效 schema 不会延迟到首次调用才暴露。
#[test]
fn registry_rejects_invalid_schema_during_construction() -> Result<()> {
    let spec = ToolSpec::new(
        "broken_tool",
        "has an invalid schema",
        json!({ "type": 42 }),
    )?;
    let result = ToolRegistry::new(vec![Tool::new(spec, Arc::new(ContextEchoExecutor))]);

    let error = match result {
        Ok(_) => bail!("invalid schema registry unexpectedly succeeded"),
        Err(error) => error,
    };
    assert!(error
        .to_string()
        .contains("invalid input schema for tool broken_tool"));
    Ok(())
}

// 场景：工具 schema 引用远程资源；预期：注册表构造拒绝外部 $ref 并指出工具名；不变量/副作用：schema 编译不访问网络或文件系统。
#[test]
fn registry_rejects_external_schema_references() -> Result<()> {
    let spec = ToolSpec::new(
        "remote_schema_tool",
        "must remain self-contained",
        json!({ "$ref": "https://example.com/tool.schema.json" }),
    )?;
    let result = ToolRegistry::new(vec![Tool::new(spec, Arc::new(ContextEchoExecutor))]);

    let error = match result {
        Ok(_) => bail!("external schema reference unexpectedly succeeded"),
        Err(error) => error,
    };
    let message = format!("{error:#}");
    assert!(message.contains("invalid input schema for tool remote_schema_tool"));
    assert!(message.contains("external schema reference is not allowed"));
    Ok(())
}

// 场景：工具 schema 使用同一文档内的 $defs 引用；预期：本地引用可编译并验证合法输入；不变量/副作用：允许自包含复用但不进行外部资源解析。
#[test]
fn registry_accepts_local_schema_references() -> Result<()> {
    let spec = ToolSpec::new(
        "local_schema_tool",
        "uses a local definition",
        json!({
            "$defs": { "path": { "type": "string" } },
            "$ref": "#/$defs/path"
        }),
    )?;
    let registry = ToolRegistry::new(vec![Tool::new(spec, Arc::new(ContextEchoExecutor))])?;
    let call = ToolCall::new("call-local", "local_schema_tool", json!("README.md"))?;
    let tool = registry
        .resolve(call.name())
        .ok_or_else(|| anyhow::anyhow!("registered tool was not resolved"))?;

    assert_eq!(registry.validate_input(tool, &call), Ok(()));
    Ok(())
}

// 场景：const 中的普通 JSON 数据恰好包含名为 $ref 的字段；预期：注册表把它当作字面量而非外部 schema 引用；不变量/副作用：外部资源守门只作用于真实 schema 引用且不触发 IO。
#[test]
fn registry_does_not_treat_ref_shaped_literal_data_as_schema_reference() -> Result<()> {
    let literal = json!({ "$ref": "https://example.com/not-a-schema.json" });
    let spec = ToolSpec::new(
        "literal_tool",
        "accepts one exact JSON literal",
        json!({ "const": literal.clone() }),
    )?;
    let registry = ToolRegistry::new(vec![Tool::new(spec, Arc::new(ContextEchoExecutor))])?;
    let call = ToolCall::new("call-literal", "literal_tool", literal)?;
    let tool = registry
        .resolve(call.name())
        .ok_or_else(|| anyhow::anyhow!("registered tool was not resolved"))?;

    assert_eq!(registry.validate_input(tool, &call), Ok(()));
    Ok(())
}

// 场景：同一注册表校验合法与非法输入；预期：合法输入通过、缺少必填字段的输入返回模型可见错误；不变量/副作用：校验只读预编译 validator，绝不调用 executor。
#[test]
fn registry_validates_input_without_executing_tool() -> Result<()> {
    let call_count = Arc::new(AtomicUsize::new(0));
    let registry = ToolRegistry::new(vec![returning_tool(
        "read_file",
        ToolOutput::Succeeded(ToolContent::Text("content".to_owned())),
        Arc::clone(&call_count),
    )?])?;
    let tool = registry
        .resolve("read_file")
        .ok_or_else(|| anyhow::anyhow!("registered tool was not resolved"))?;
    let valid = ToolCall::new("call-valid", "read_file", json!({ "path": "README.md" }))?;
    let invalid = ToolCall::new("call-invalid", "read_file", json!({}))?;

    assert_eq!(registry.validate_input(tool, &valid), Ok(()));
    let validation_error = registry
        .validate_input(tool, &invalid)
        .err()
        .ok_or_else(|| anyhow::anyhow!("invalid input unexpectedly passed validation"))?;
    assert!(!validation_error.is_empty());
    assert_eq!(call_count.load(Ordering::SeqCst), 0);
    Ok(())
}

// 场景：执行成功工具并传入调用数据与工作目录；预期：输出规范化为 Succeeded ToolResult 且身份、JSON 内容完整；不变量/副作用：上下文按引用传入，tools 不保存或改写 cwd。
#[tokio::test]
async fn tool_execute_normalizes_success_and_passes_borrowed_context() -> Result<()> {
    let tool = Tool::new(
        ToolSpec::new("echo_context", "echo call context", object_schema())?,
        Arc::new(ContextEchoExecutor),
    );
    let call = ToolCall::new(
        "call-context",
        "echo_context",
        json!({ "path": "README.md" }),
    )?;
    let working_dir = Path::new("workspace/project");

    let result = tool.execute(&call, working_dir).await?;

    assert_eq!(result.tool_use_id(), "call-context");
    assert_eq!(result.name(), "echo_context");
    assert_eq!(result.status(), &ToolResultStatus::Succeeded);
    assert_eq!(
        result.content(),
        &ToolContent::Json(json!({
            "input": { "path": "README.md" },
            "working_dir": "workspace/project"
        }))
    );
    Ok(())
}

// 场景：executor 返回可重试的预期失败；预期：ToolResult 保留失败文本和 retryable=true；不变量/副作用：一次 execute 只调用 executor 一次，不在 tools 内自动重试。
#[tokio::test]
async fn tool_execute_preserves_expected_failure_without_retrying() -> Result<()> {
    let call_count = Arc::new(AtomicUsize::new(0));
    let tool = returning_tool(
        "read_file",
        ToolOutput::Failed {
            content: ToolContent::Text("file is temporarily locked".to_owned()),
            retryable: true,
        },
        Arc::clone(&call_count),
    )?;
    let call = ToolCall::new("call-failed", "read_file", json!({ "path": "README.md" }))?;

    let result = tool.execute(&call, Path::new("workspace")).await?;

    assert_eq!(
        result.status(),
        &ToolResultStatus::Failed { retryable: true }
    );
    assert_eq!(
        result.content(),
        &ToolContent::Text("file is temporarily locked".to_owned())
    );
    assert_eq!(call_count.load(Ordering::SeqCst), 1);
    Ok(())
}

// 场景：executor 无法确认副作用是否发生并返回 OutcomeUnknown；预期：结果状态与诊断文本被原样规范化；不变量/副作用：tools 不把不确定结果误报为普通失败。
#[tokio::test]
async fn tool_execute_preserves_unknown_outcome() -> Result<()> {
    let call_count = Arc::new(AtomicUsize::new(0));
    let tool = returning_tool(
        "write_file",
        ToolOutput::OutcomeUnknown(ToolContent::Text(
            "connection closed after request was sent".to_owned(),
        )),
        Arc::clone(&call_count),
    )?;
    let call = ToolCall::new("call-unknown", "write_file", json!({ "path": "README.md" }))?;

    let result = tool.execute(&call, Path::new("workspace")).await?;

    assert_eq!(result.status(), &ToolResultStatus::OutcomeUnknown);
    assert_eq!(call_count.load(Ordering::SeqCst), 1);
    Ok(())
}

// 场景：executor 返回基础设施错误；预期：Tool::execute 原样传播 anyhow 错误；不变量/副作用：tools 不擅自生成 ToolResult，OutcomeUnknown 的持久化由未来 loop 边界负责。
#[tokio::test]
async fn tool_execute_propagates_infrastructure_error() -> Result<()> {
    let tool = Tool::new(
        ToolSpec::new("remote_tool", "fails in transport", object_schema())?,
        Arc::new(FailingExecutor),
    );
    let call = ToolCall::new("call-error", "remote_tool", json!({ "path": "README.md" }))?;

    let error = match tool.execute(&call, Path::new("workspace")).await {
        Ok(_) => bail!("infrastructure failure unexpectedly returned a result"),
        Err(error) => error,
    };
    assert_eq!(error.to_string(), "executor transport failed");
    Ok(())
}

// 场景：loop 未来需要为未执行调用构造 UnknownTool、Denied 和 Cancelled 结果；预期：crate 内构造器保留调用身份及指定状态；不变量/副作用：状态构造不调用 executor。
#[test]
fn tool_result_constructor_supports_non_executor_outcomes() -> Result<()> {
    let call = ToolCall::new("call-denied", "shell", json!({ "command": "pwd" }))?;
    let unknown = ToolResult::new(
        &call,
        ToolResultStatus::UnknownTool,
        ToolContent::Text("unknown tool: shell".to_owned()),
    );
    let denied = ToolResult::new(
        &call,
        ToolResultStatus::Denied,
        ToolContent::Text("tool permission denied".to_owned()),
    );
    let cancelled = ToolResult::new(
        &call,
        ToolResultStatus::Cancelled {
            reason: ToolCancellationReason::User,
        },
        ToolContent::Text("cancelled by user".to_owned()),
    );

    assert_eq!(unknown.status(), &ToolResultStatus::UnknownTool);
    assert_eq!(denied.status(), &ToolResultStatus::Denied);
    assert_eq!(
        cancelled.status(),
        &ToolResultStatus::Cancelled {
            reason: ToolCancellationReason::User
        }
    );
    assert_eq!(cancelled.tool_use_id(), "call-denied");
    assert_eq!(cancelled.name(), "shell");
    Ok(())
}

// 场景：ToolResultStatus 序列化用于跨 session/event 边界持久化；预期：失败与取消状态采用稳定 snake_case 外部标签；不变量/副作用：序列化不丢失 retryable 或 cancellation reason。
#[test]
fn tool_result_status_has_stable_serialized_shape() -> Result<()> {
    let failed = serde_json::to_value(ToolResultStatus::Failed { retryable: true })?;
    let cancelled = serde_json::to_value(ToolResultStatus::Cancelled {
        reason: ToolCancellationReason::Parent,
    })?;

    assert_eq!(failed, json!({ "failed": { "retryable": true } }));
    assert_eq!(cancelled, json!({ "cancelled": { "reason": "parent" } }));
    Ok(())
}
