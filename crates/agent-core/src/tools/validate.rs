use anyhow::{
    Context,
    Result,
    bail,
};
use jsonschema::{
    Retrieve,
    Uri,
    Validator,
};
use serde_json::Value;

use super::ToolSpec;

struct RejectExternalRetriever;

impl Retrieve for RejectExternalRetriever {
    fn retrieve(
        &self,
        uri: &Uri<String>,
    ) -> std::result::Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        Err(format!("external schema reference is not allowed: {}", uri.as_str()).into())
    }
}

pub(super) fn compile_input_validator(spec: &ToolSpec) -> Result<Validator> {
    if !spec.input_schema().is_object() {
        bail!("input schema must be a JSON object");
    }

    jsonschema::draft202012::meta::validate(spec.input_schema()).map_err(|error| {
        anyhow::anyhow!(
            "schema does not conform to JSON Schema Draft 2020-12: {}",
            error
        )
    })?;

    jsonschema::draft202012::options()
        .with_retriever(RejectExternalRetriever)
        .build(spec.input_schema())
        .context("schema could not be compiled")
}
