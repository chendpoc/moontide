use std::io::{
    self,
    Write,
};

use agent::{
    ContentBlock,
    ModelResponse,
};
use anyhow::Result;

pub(crate) fn assistant_text(response: &ModelResponse) -> String {
    response
        .content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => Some(text.as_str()),
            ContentBlock::Thinking { .. }
            | ContentBlock::ToolUse { .. }
            | ContentBlock::ToolResult { .. } => None,
        })
        .collect()
}

pub(crate) fn write_assistant_stdout<W: Write>(
    response: &ModelResponse,
    mut writer: W,
) -> Result<()> {
    let text = assistant_text(response);
    writer.write_all(text.as_bytes())?;
    if !text.ends_with('\n') {
        writer.write_all(b"\n")?;
    }
    writer.flush()?;
    Ok(())
}

pub(crate) fn write_diagnostic_stderr(message: &str) -> io::Result<()> {
    let mut stderr = io::stderr().lock();
    writeln!(stderr, "{message}")
}
