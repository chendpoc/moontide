use agent_core::tools::ToolRegistry;
use anyhow::{
    Result,
    bail,
    ensure,
};
use serde_json::json;

use crate::builtin_tool_definitions;
use crate::catalog::ToolDefinition;

// 测试场景：构建完整 builtin catalog 并交给唯一运行时 registry；预期 definition 名称有序、唯一且与产出 spec 配对；不变量/副作用：build 只组装工具，不执行 grep 文件 IO。
#[test]
fn catalog_is_stable_unique_and_builds_runtime_tools() -> Result<()> {
    let definitions = builtin_tool_definitions();
    let names = definitions
        .iter()
        .map(ToolDefinition::name)
        .collect::<Vec<_>>();
    let mut sorted_names = names.clone();
    sorted_names.sort_unstable();
    ensure!(names == sorted_names);
    sorted_names.dedup();
    ensure!(names.len() == sorted_names.len());

    let tools = definitions
        .iter()
        .map(ToolDefinition::build)
        .collect::<Result<Vec<_>>>()?;
    for (definition, tool) in definitions.iter().zip(&tools) {
        ensure!(definition.name() == tool.spec().name());
    }

    let registry = ToolRegistry::new(tools)?;
    for name in [
        "bash",
        "edit",
        "find",
        "grep",
        "read",
        "web_search",
        "write",
    ] {
        ensure!(registry.resolve(name).is_some());
    }
    Ok(())
}

// 测试场景：find 按 glob 在工作目录递归发现文件；预期只返回匹配路径、遵守 .gitignore 且结果稳定；不变量/副作用：不读取文件内容、不越过工作目录。
#[tokio::test]
async fn find_discovers_files_by_glob_and_respects_ignore_rules() -> Result<()> {
    use std::fs;
    use std::sync::Arc;

    use agent_core::tools::{
        ToolCall,
        ToolContent,
        ToolExecutor,
    };
    use serde_json::json;
    use tempfile::TempDir;

    let workspace = TempDir::new()?;
    fs::create_dir(workspace.path().join("nested"))?;
    fs::write(workspace.path().join(".gitignore"), "ignored.rs\n")?;
    fs::write(workspace.path().join("main.rs"), "not read by find\n")?;
    fs::write(
        workspace.path().join("nested").join("lib.rs"),
        "also not read by find\n",
    )?;
    fs::write(
        workspace.path().join("nested").join("ignored.rs"),
        "ignored\n",
    )?;
    fs::write(workspace.path().join("README.md"), "not a Rust file\n")?;

    let executor = Arc::new(crate::find::FindExecutor);
    let call = ToolCall::new(
        "find-1",
        "find",
        json!({ "pattern": "**/*.rs", "max_results": 10 }),
    )?;
    let result = executor.execute(&call, workspace.path()).await?;

    match result.content() {
        ToolContent::Text(text) => {
            ensure!(text == "main.rs\nnested/lib.rs");
            ensure!(!text.contains("ignored.rs"));
            ensure!(!text.contains("not read by find"));
        }
        other => bail!("unexpected find content {other:?}"),
    }
    Ok(())
}

// 测试场景：find 收到非法 glob、文件路径和超过结果上限的目录；预期分别返回不可重试失败、路径错误和有界成功结果；不变量/副作用：不会执行文件内容读取。
#[tokio::test]
async fn find_rejects_invalid_targets_and_bounds_results() -> Result<()> {
    use std::fs;
    use std::sync::Arc;

    use agent_core::tools::{
        ToolCall,
        ToolContent,
        ToolExecutor,
        ToolResultStatus,
    };
    use serde_json::json;
    use tempfile::TempDir;

    let workspace = TempDir::new()?;
    fs::write(workspace.path().join("one.rs"), "")?;
    fs::write(workspace.path().join("two.rs"), "")?;
    let executor = Arc::new(crate::find::FindExecutor);

    let invalid = ToolCall::new("find-2", "find", json!({ "pattern": "[" }))?;
    let invalid_result = executor.execute(&invalid, workspace.path()).await?;
    ensure!(matches!(
        invalid_result.status(),
        ToolResultStatus::Failed { retryable: false }
    ));

    let file_target = ToolCall::new(
        "find-3",
        "find",
        json!({ "pattern": "*.rs", "path": "one.rs" }),
    )?;
    let file_result = executor.execute(&file_target, workspace.path()).await?;
    ensure!(matches!(
        file_result.status(),
        ToolResultStatus::Failed { retryable: false }
    ));

    let bounded = ToolCall::new(
        "find-4",
        "find",
        json!({ "pattern": "*.rs", "max_results": 1 }),
    )?;
    let bounded_result = executor.execute(&bounded, workspace.path()).await?;
    match bounded_result.content() {
        ToolContent::Text(text) => ensure!(text.lines().count() == 1),
        other => bail!("unexpected bounded find content {other:?}"),
    }
    Ok(())
}

// 测试场景：人为声明名称与 builder 产物不一致的 catalog 条目；预期 build 在组合阶段拒绝漂移；不变量/副作用：错误发生在 registry 与任何工具执行之前。
#[test]
fn definition_rejects_a_builder_name_mismatch() -> Result<()> {
    let definition = ToolDefinition::new("not-grep", crate::grep::build);
    let error = match definition.build() {
        Ok(_) => anyhow::bail!("mismatched definition unexpectedly built a tool"),
        Err(error) => error,
    };

    ensure!(error.to_string().contains("tool definition name mismatch"));
    Ok(())
}

// 测试场景：读取 grep 的模型可见 schema；预期字段、required、默认值和范围与 executor typed input 一致；不变量/副作用：spec 构造无文件 IO，且 schema 可被 ToolRegistry 编译。
#[test]
fn grep_schema_matches_the_typed_input_contract() -> Result<()> {
    let tool = crate::grep::build()?;
    let schema = tool.spec().input_schema();

    ensure!(tool.spec().name() == "grep");
    ensure!(schema.pointer("/type") == Some(&json!("object")));
    ensure!(schema.pointer("/required") == Some(&json!(["pattern"])));
    ensure!(schema.pointer("/additionalProperties") == Some(&json!(false)));
    ensure!(schema.pointer("/properties/pattern/type") == Some(&json!("string")));
    ensure!(schema.pointer("/properties/pattern/minLength") == Some(&json!(1)));
    ensure!(schema.pointer("/properties/path/type") == Some(&json!("string")));
    ensure!(schema.pointer("/properties/path/default") == Some(&json!(".")));
    ensure!(schema.pointer("/properties/max_results/type") == Some(&json!("integer")));
    ensure!(schema.pointer("/properties/max_results/default") == Some(&json!(100)));
    ensure!(schema.pointer("/properties/max_results/minimum") == Some(&json!(1)));
    ensure!(schema.pointer("/properties/max_results/maximum") == Some(&json!(1000)));

    ToolRegistry::new(vec![tool])?;
    Ok(())
}

// 测试场景：读取 web_search 的模型可见 schema；预期 query/max_results 的约束、默认值和禁止额外字段与 executor typed input 一致；不变量/副作用：只构造 HTTP client 与 ToolSpec，不发网络请求。
#[test]
fn web_search_schema_matches_the_typed_input_contract() -> Result<()> {
    let tool = crate::web_search::build()?;
    let schema = tool.spec().input_schema();

    ensure!(tool.spec().name() == "web_search");
    ensure!(schema.pointer("/type") == Some(&json!("object")));
    ensure!(schema.pointer("/required") == Some(&json!(["query"])));
    ensure!(schema.pointer("/additionalProperties") == Some(&json!(false)));
    ensure!(schema.pointer("/properties/query/type") == Some(&json!("string")));
    ensure!(schema.pointer("/properties/query/minLength") == Some(&json!(1)));
    ensure!(schema.pointer("/properties/max_results/type") == Some(&json!("integer")));
    ensure!(schema.pointer("/properties/max_results/default") == Some(&json!(5)));
    ensure!(schema.pointer("/properties/max_results/minimum") == Some(&json!(1)));
    ensure!(schema.pointer("/properties/max_results/maximum") == Some(&json!(20)));

    ToolRegistry::new(vec![tool])?;
    Ok(())
}

// 测试场景：read/write/edit 在 working directory 内的基本文件操作；预期与 Pi 默认 coding tools 一致的语义。
#[tokio::test]
async fn read_write_edit_round_trip() -> Result<()> {
    use std::sync::Arc;

    use agent_core::tools::{
        ToolCall,
        ToolContent,
        ToolExecutor,
        ToolResultStatus,
    };
    use serde_json::json;
    use tempfile::TempDir;

    let workspace = TempDir::new()?;
    let read = Arc::new(crate::read::ReadExecutor);
    let write = Arc::new(crate::write::WriteExecutor);
    let edit = Arc::new(crate::edit::EditExecutor);

    let write_call = ToolCall::new(
        "w1",
        "write",
        json!({
            "path": "sample.txt",
            "content": "hello world\nsecond line\n"
        }),
    )?;
    let write_result = write.execute(&write_call, workspace.path()).await?;
    ensure!(matches!(write_result.status(), ToolResultStatus::Succeeded));

    let read_call = ToolCall::new("r1", "read", json!({ "path": "sample.txt", "limit": 1 }))?;
    let read_result = read.execute(&read_call, workspace.path()).await?;
    match read_result.content() {
        ToolContent::Text(text) => ensure!(text.contains("hello world")),
        other => bail!("unexpected read content {other:?}"),
    }

    let edit_call = ToolCall::new(
        "e1",
        "edit",
        json!({
            "path": "sample.txt",
            "edits": [{ "old_string": "second line", "new_string": "edited line" }]
        }),
    )?;
    let edit_result = edit.execute(&edit_call, workspace.path()).await?;
    ensure!(matches!(edit_result.status(), ToolResultStatus::Succeeded));

    let content = std::fs::read_to_string(workspace.path().join("sample.txt"))?;
    ensure!(content.contains("edited line"));
    ensure!(!content.contains("second line"));
    Ok(())
}

// 测试场景：bash 在 working directory 内执行简单命令；预期返回成功文本结果。
#[tokio::test]
async fn bash_runs_a_simple_command() -> Result<()> {
    use std::sync::Arc;

    use agent_core::tools::{
        ToolCall,
        ToolContent,
        ToolExecutor,
        ToolResultStatus,
    };
    use serde_json::json;
    use tempfile::TempDir;

    let workspace = TempDir::new()?;
    let bash = Arc::new(crate::bash::BashExecutor);
    let call = ToolCall::new(
        "b1",
        "bash",
        json!({ "command": if cfg!(windows) { "echo hello" } else { "printf hello" } }),
    )?;
    let result = bash.execute(&call, workspace.path()).await?;
    ensure!(matches!(result.status(), ToolResultStatus::Succeeded));
    match result.content() {
        ToolContent::Text(text) => ensure!(text.contains("hello")),
        other => bail!("unexpected bash content {other:?}"),
    }
    Ok(())
}

// 测试场景：静态检查 grep 的 spec/executor 源文件边界；预期 spec 不包含 IO 依赖且 executor 不构造 ToolSpec/schema；不变量/副作用：未来重构不能把声明与副作用重新耦合。
#[test]
fn grep_spec_and_executor_remain_physically_separated() -> Result<()> {
    let spec_source = include_str!("grep/spec.rs");
    for forbidden in [
        "std::fs",
        "std::net",
        "std::process",
        "ignore::",
        "tokio::",
        "reqwest::",
    ] {
        ensure!(
            !spec_source.contains(forbidden),
            "grep spec contains forbidden IO dependency {forbidden}"
        );
    }

    let executor_source = include_str!("grep/executor.rs");
    for forbidden in ["ToolSpec", "input_schema", "\"properties\""] {
        ensure!(
            !executor_source.contains(forbidden),
            "grep executor contains schema token {forbidden}"
        );
    }
    Ok(())
}
