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
    assistant_text_from_blocks(&response.content)
}

pub(crate) fn assistant_text_from_blocks(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => Some(text.as_str()),
            ContentBlock::Thinking { .. }
            | ContentBlock::ToolUse { .. }
            | ContentBlock::ToolResult { .. } => None,
        })
        .collect()
}

pub(crate) fn write_assistant_text<W: Write>(text: String, mut writer: W) -> Result<()> {
    writer.write_all(text.as_bytes())?;
    if !text.is_empty() && !text.ends_with('\n') {
        writer.write_all(b"\n")?;
    }
    writer.flush()?;
    Ok(())
}

pub(crate) fn write_diagnostic_stderr(message: &str) -> io::Result<()> {
    let mut stderr = io::stderr().lock();
    writeln!(stderr, "{message}")
}
