use std::io::{
    self,
    Write,
};
use std::sync::atomic::{
    AtomicBool,
    Ordering,
};
use std::sync::{
    Arc,
    Mutex,
};

use agent::{
    ContentBlock,
    LlmCallOutcome,
    ModelResponse,
    ModelResponseSnapshot,
    PendingBlock,
    ProgressEvent,
    ProgressObserver,
    SessionItem,
    SessionSnapshot,
    SessionSummary,
    ToolCall,
    ToolContent,
    ToolResult,
    ToolResultStatus,
};
use anyhow::{
    Result,
    anyhow,
};

use crate::approval::truncate_preview;
use crate::render::assistant_text_from_blocks;

const TOOL_BODY_CHARS: usize = 240;
const PREVIEW_CHARS: usize = 160;

/// Live Harness Console projection of Progress events.
pub(crate) struct ConsoleRenderer {
    thinking_visible: Arc<AtomicBool>,
    state: Mutex<ConsoleRenderState>,
}

#[derive(Debug, Default)]
pub(crate) struct ConsoleRenderState {
    call_id: Option<String>,
    call_text: String,
    call_thinking: String,
    last_finalized: String,
    turn_text: String,
    saw_finalized: bool,
    stdout_needs_nl: bool,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct ConsolePaint {
    pub stdout: String,
    pub stderr: String,
}

impl ConsolePaint {
    fn stdout(text: impl Into<String>) -> Self {
        Self {
            stdout: text.into(),
            stderr: String::new(),
        }
    }

    fn is_empty(&self) -> bool {
        self.stdout.is_empty() && self.stderr.is_empty()
    }
}

impl ConsoleRenderer {
    pub(crate) fn new(thinking_visible: Arc<AtomicBool>) -> Self {
        Self {
            thinking_visible,
            state: Mutex::new(ConsoleRenderState::default()),
        }
    }

    pub(crate) fn is_thinking_visible(&self) -> bool {
        self.thinking_visible.load(Ordering::SeqCst)
    }

    pub(crate) fn set_thinking_visible(&self, visible: bool) {
        self.thinking_visible.store(visible, Ordering::SeqCst);
    }

    pub(crate) fn begin_turn(&self) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow!("console renderer lock poisoned"))?;
        *state = ConsoleRenderState::default();
        Ok(())
    }

    pub(crate) fn fallback_assistant_text(
        &self,
        response: &ModelResponse,
    ) -> Result<Option<String>> {
        let state = self
            .state
            .lock()
            .map_err(|_| anyhow!("console renderer lock poisoned"))?;
        Ok(fallback_assistant_text(&state, response))
    }

    pub(crate) fn ensure_stdout_newline(&self) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow!("console renderer lock poisoned"))?;
        if state.stdout_needs_nl {
            write_stdout("\n")?;
            state.stdout_needs_nl = false;
        }
        Ok(())
    }
}

impl ProgressObserver for ConsoleRenderer {
    fn on_progress(&self, event: &ProgressEvent) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow!("console renderer lock poisoned"))?;
        let paint = apply_progress(&mut state, self.is_thinking_visible(), event);
        write_paint(&mut state, &paint)
    }
}

pub(crate) struct FanoutObserver {
    pub observers: Vec<Arc<dyn ProgressObserver>>,
}

impl ProgressObserver for FanoutObserver {
    fn on_progress(&self, event: &ProgressEvent) -> Result<()> {
        let mut first_error = None;
        for observer in &self.observers {
            if let Err(error) = observer.on_progress(event) {
                first_error.get_or_insert(error);
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

pub(crate) fn apply_progress(
    state: &mut ConsoleRenderState,
    thinking_visible: bool,
    event: &ProgressEvent,
) -> ConsolePaint {
    match event {
        ProgressEvent::TurnStarted { .. } => {
            *state = ConsoleRenderState::default();
            ConsolePaint::default()
        }
        ProgressEvent::LlmCallStarted { llm_call_id, .. } => {
            state.call_id = Some(llm_call_id.clone());
            state.call_text.clear();
            state.call_thinking.clear();
            ConsolePaint::default()
        }
        ProgressEvent::AssistantResponseSnapshot { snapshot, .. } => {
            snapshot_paint(state, thinking_visible, snapshot)
        }
        ProgressEvent::AssistantFinalized { blocks, .. } => finalized_paint(state, blocks),
        ProgressEvent::ToolCall { call, .. } => {
            let mut paint = precede_stderr(state);
            paint.stderr.push_str(&format_tool_call(call));
            paint.stderr.push('\n');
            paint
        }
        ProgressEvent::ToolResult { result, .. } => {
            let mut paint = precede_stderr(state);
            paint.stderr.push_str(&format_tool_result(result));
            paint.stderr.push('\n');
            paint
        }
        ProgressEvent::LlmCallEnded { outcome, .. } => llm_ended_paint(state, outcome),
        ProgressEvent::TurnEnded { .. } => {
            if state.stdout_needs_nl {
                state.stdout_needs_nl = false;
                ConsolePaint::stdout("\n")
            } else {
                ConsolePaint::default()
            }
        }
    }
}

pub(crate) fn snapshot_assistant_text(snapshot: &ModelResponseSnapshot) -> String {
    let mut text = assistant_text_from_blocks(&snapshot.content);
    if let Some(PendingBlock::Text { text: pending }) = &snapshot.pending {
        text.push_str(pending);
    }
    text
}

pub(crate) fn snapshot_thinking_text(snapshot: &ModelResponseSnapshot) -> String {
    let mut text = String::new();
    for block in &snapshot.content {
        if let ContentBlock::Thinking { thinking } = block {
            text.push_str(thinking);
        }
    }
    if let Some(PendingBlock::Thinking { thinking }) = &snapshot.pending {
        text.push_str(thinking);
    }
    text
}

pub(crate) fn text_delta(already: &str, full: &str) -> String {
    if full == already {
        String::new()
    } else if let Some(suffix) = full.strip_prefix(already) {
        suffix.to_owned()
    } else if already.is_empty() {
        full.to_owned()
    } else {
        format!("\n{full}")
    }
}

pub(crate) fn fallback_assistant_text(
    state: &ConsoleRenderState,
    response: &ModelResponse,
) -> Option<String> {
    let final_text = crate::render::assistant_text(response);
    if final_text.is_empty() {
        return None;
    }
    if state.saw_finalized
        && (state.last_finalized == final_text || state.turn_text.ends_with(&final_text))
    {
        None
    } else {
        Some(final_text)
    }
}

pub(crate) fn format_tool_call(call: &ToolCall) -> String {
    let input = serde_json::to_string(call.input()).unwrap_or_else(|_| "<invalid-json>".into());
    format!("[tool] {}\n  {}", call.name(), truncate_preview(&input))
}

pub(crate) fn format_tool_result(result: &ToolResult) -> String {
    let body = tool_content_preview(result.content());
    if body.is_empty() {
        format!(
            "[tool] {}  {}",
            result.name(),
            status_label(result.status())
        )
    } else {
        let indented = body
            .lines()
            .map(|line| format!("  {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        format!(
            "[tool] {}  {}\n{indented}",
            result.name(),
            status_label(result.status())
        )
    }
}

pub(crate) fn format_session_list(summaries: &[SessionSummary], active: Option<&str>) -> String {
    if summaries.is_empty() {
        return "no persisted sessions".into();
    }
    let mut rows = summaries.to_vec();
    rows.sort_by(|left, right| {
        right
            .last_turn
            .cmp(&left.last_turn)
            .then(right.item_count.cmp(&left.item_count))
            .then(left.session_id.cmp(&right.session_id))
    });
    let mut lines = vec!["sessions:".to_owned()];
    for summary in rows {
        let marker = if active == Some(summary.session_id.as_str()) {
            "*"
        } else {
            " "
        };
        let turns = summary
            .last_turn
            .map(|turn| turn.to_string())
            .unwrap_or_else(|| "-".into());
        lines.push(format!(
            "{marker} {}  turns={turns} items={}",
            summary.session_id, summary.item_count
        ));
    }
    lines.join("\n")
}

pub(crate) fn format_resume_preview(snapshot: &SessionSnapshot) -> String {
    let mut excerpts = Vec::new();
    for item in &snapshot.items {
        match item {
            SessionItem::UserMessage { text, .. } => {
                excerpts.push(("you", text.clone()));
            }
            SessionItem::AssistantMessage { blocks, .. } => {
                let text = assistant_text_from_blocks(blocks);
                if !text.is_empty() {
                    excerpts.push(("assistant", text));
                }
            }
            _ => {}
        }
    }
    let start = excerpts.len().saturating_sub(4);
    excerpts[start..]
        .iter()
        .map(|(label, text)| format!("{label}: {}", truncate_chars(text, PREVIEW_CHARS)))
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn short_session_id(session_id: &str) -> &str {
    session_id.get(..8).unwrap_or(session_id)
}

fn snapshot_paint(
    state: &mut ConsoleRenderState,
    thinking_visible: bool,
    snapshot: &ModelResponseSnapshot,
) -> ConsolePaint {
    let mut paint = ConsolePaint::default();
    if thinking_visible {
        let thinking = snapshot_thinking_text(snapshot);
        let delta = text_delta(&state.call_thinking, &thinking);
        if !delta.is_empty() {
            if state.call_thinking.is_empty() {
                paint.stderr.push_str("[thinking]\n");
            }
            paint.stderr.push_str(&delta);
            state.call_thinking = thinking;
        }
    }
    let text = snapshot_assistant_text(snapshot);
    let delta = text_delta(&state.call_text, &text);
    if !delta.is_empty() {
        paint.stdout.push_str(&delta);
        state.call_text = text;
        state.stdout_needs_nl = !state.call_text.ends_with('\n');
    }
    paint
}

fn finalized_paint(state: &mut ConsoleRenderState, blocks: &[ContentBlock]) -> ConsolePaint {
    let text = assistant_text_from_blocks(blocks);
    let delta = text_delta(&state.call_text, &text);
    state.call_text = text.clone();
    state.last_finalized = text.clone();
    state.saw_finalized = true;
    if !text.is_empty() {
        state.turn_text.push_str(&text);
    }
    if delta.is_empty() {
        if state.stdout_needs_nl {
            state.stdout_needs_nl = false;
            ConsolePaint::stdout("\n")
        } else {
            ConsolePaint::default()
        }
    } else {
        let mut stdout = delta;
        if !stdout.ends_with('\n') {
            stdout.push('\n');
        }
        state.stdout_needs_nl = false;
        ConsolePaint::stdout(stdout)
    }
}

fn llm_ended_paint(state: &mut ConsoleRenderState, outcome: &LlmCallOutcome) -> ConsolePaint {
    match outcome {
        LlmCallOutcome::Succeeded { .. } => ConsolePaint::default(),
        LlmCallOutcome::Failed { kind } => {
            let mut paint = precede_stderr(state);
            paint.stderr.push_str(&format!("[llm] failed ({kind:?})\n"));
            paint
        }
        LlmCallOutcome::Cancelled { .. } => {
            let mut paint = precede_stderr(state);
            paint.stderr.push_str("[llm] cancelled\n");
            paint
        }
    }
}

fn precede_stderr(state: &mut ConsoleRenderState) -> ConsolePaint {
    if state.stdout_needs_nl {
        state.stdout_needs_nl = false;
        ConsolePaint {
            stdout: "\n".into(),
            stderr: String::new(),
        }
    } else {
        ConsolePaint::default()
    }
}

fn tool_content_preview(content: &ToolContent) -> String {
    let raw = match content {
        ToolContent::Text(text) => text.clone(),
        ToolContent::Json(value) => {
            serde_json::to_string(value).unwrap_or_else(|_| value.to_string())
        }
    };
    truncate_chars(&raw, TOOL_BODY_CHARS)
}

fn status_label(status: &ToolResultStatus) -> &'static str {
    match status {
        ToolResultStatus::Succeeded => "ok",
        ToolResultStatus::Failed { retryable: true } => "failed (retryable)",
        ToolResultStatus::Failed { retryable: false } => "failed",
        ToolResultStatus::InvalidArguments => "invalid arguments",
        ToolResultStatus::UnknownTool => "unknown tool",
        ToolResultStatus::Denied => "denied",
        ToolResultStatus::Cancelled { .. } => "cancelled",
        ToolResultStatus::OutcomeUnknown => "unknown",
    }
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let preview: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{preview}…")
    } else {
        preview
    }
}

fn write_paint(state: &mut ConsoleRenderState, paint: &ConsolePaint) -> Result<()> {
    if paint.is_empty() {
        return Ok(());
    }
    if !paint.stdout.is_empty() {
        write_stdout(&paint.stdout)?;
        state.stdout_needs_nl = !paint.stdout.ends_with('\n');
    }
    if !paint.stderr.is_empty() {
        write_stderr(&paint.stderr)?;
    }
    Ok(())
}

fn write_stdout(text: &str) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    stdout.write_all(text.as_bytes())?;
    stdout.flush()
}

fn write_stderr(text: &str) -> io::Result<()> {
    let mut stderr = io::stderr().lock();
    stderr.write_all(text.as_bytes())?;
    stderr.flush()
}

#[cfg(test)]
mod tests {
    use agent::{
        PendingBlock,
        ToolCall,
        ToolContent,
        ToolResult,
    };

    use super::*;

    // Scenario: consecutive snapshots replace the same call draft with a longer prefix.
    // Expected: only the new suffix is painted to stdout.
    // Invariant: snapshot replacement never reprints already streamed assistant text.
    #[test]
    fn snapshot_delta_emits_only_new_suffix() {
        let mut state = ConsoleRenderState::default();
        let first = apply_progress(
            &mut state,
            false,
            &ProgressEvent::AssistantResponseSnapshot {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".into(),
                update_index: 0,
                snapshot: ModelResponseSnapshot {
                    content: Vec::new(),
                    pending: Some(PendingBlock::Text { text: "Hel".into() }),
                    stop_reason: None,
                    usage: None,
                    model: None,
                },
            },
        );
        let second = apply_progress(
            &mut state,
            false,
            &ProgressEvent::AssistantResponseSnapshot {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".into(),
                update_index: 1,
                snapshot: ModelResponseSnapshot {
                    content: Vec::new(),
                    pending: Some(PendingBlock::Text {
                        text: "Hello".into(),
                    }),
                    stop_reason: None,
                    usage: None,
                    model: None,
                },
            },
        );

        assert_eq!(first.stdout, "Hel");
        assert_eq!(second.stdout, "lo");
        assert!(first.stderr.is_empty());
        assert!(second.stderr.is_empty());
    }

    // Scenario: a tool card arrives while assistant draft text is still open on stdout.
    // Expected: stdout is closed with a newline, then the tool line is written to stderr.
    // Invariant: tool rendering never shares stdout with assistant text.
    #[test]
    fn tool_call_closes_open_assistant_line() {
        let mut state = ConsoleRenderState::default();
        apply_progress(
            &mut state,
            false,
            &ProgressEvent::AssistantResponseSnapshot {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".into(),
                update_index: 0,
                snapshot: ModelResponseSnapshot {
                    content: Vec::new(),
                    pending: Some(PendingBlock::Text {
                        text: "working".into(),
                    }),
                    stop_reason: None,
                    usage: None,
                    model: None,
                },
            },
        );
        let call = ToolCall::new("tool-1", "bash", serde_json::json!({"command": "pwd"}))
            .expect("tool call");
        let paint = apply_progress(
            &mut state,
            false,
            &ProgressEvent::ToolCall {
                turn: 1,
                call: call.clone(),
            },
        );

        assert_eq!(paint.stdout, "\n");
        assert!(paint.stderr.contains("[tool] bash"));
        assert!(paint.stderr.contains("pwd"));
        let result = ToolResult::succeeded(&call, ToolContent::Text(" /tmp\n".into()));
        let result_paint = apply_progress(
            &mut state,
            false,
            &ProgressEvent::ToolResult { turn: 1, result },
        );
        assert!(result_paint.stdout.is_empty());
        assert!(result_paint.stderr.contains("ok"));
    }

    // Scenario: live path already finalized the last assistant text of a turn.
    // Expected: ModelResponse fallback is suppressed.
    // Invariant: successful live rendering does not duplicate the final reply.
    #[test]
    fn finalized_text_suppresses_model_response_fallback() {
        let mut state = ConsoleRenderState::default();
        apply_progress(
            &mut state,
            false,
            &ProgressEvent::AssistantFinalized {
                turn: 1,
                llm_call_id: "call-1".into(),
                blocks: vec![ContentBlock::Text {
                    text: "done".into(),
                }],
            },
        );
        let response = ModelResponse {
            content: vec![ContentBlock::Text {
                text: "done".into(),
            }],
            stop_reason: agent::StopReason::EndTurn,
            usage: None,
            model: None,
            response_id: None,
        };
        assert_eq!(fallback_assistant_text(&state, &response), None);
    }

    // Scenario: thinking snapshots arrive while the console thinking display is enabled.
    // Expected: a thinking header and deltas go to stderr, not stdout.
    // Invariant: thinking never becomes assistant stdout.
    #[test]
    fn thinking_display_stays_on_stderr() {
        let mut state = ConsoleRenderState::default();
        let paint = apply_progress(
            &mut state,
            true,
            &ProgressEvent::AssistantResponseSnapshot {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".into(),
                update_index: 0,
                snapshot: ModelResponseSnapshot {
                    content: Vec::new(),
                    pending: Some(PendingBlock::Thinking {
                        thinking: "plan".into(),
                    }),
                    stop_reason: None,
                    usage: None,
                    model: None,
                },
            },
        );
        assert!(paint.stdout.is_empty());
        assert!(paint.stderr.contains("[thinking]"));
        assert!(paint.stderr.contains("plan"));
    }
}
