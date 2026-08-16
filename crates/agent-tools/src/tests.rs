use agent_core::tools::ToolRegistry;
use anyhow::{ensure, Result};
use serde_json::json;

use crate::{builtin_tool_definitions, catalog::ToolDefinition};

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
    ensure!(registry.resolve("grep").is_some());
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
