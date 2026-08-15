use anyhow::{anyhow, Result};

use crate::event::RunEvent;

use super::store::SessionStore;
use super::types::{CompactionKind, SessionItem, SessionItemDraft};

/// Maps a committable `RunEvent` to a `SessionItem` and persists it.
///
/// Non-committable events return an error with a clear message.
pub fn commit_from_event<'a>(
    store: &'a mut SessionStore,
    event: &RunEvent,
) -> Result<&'a SessionItem> {
    let draft = match event {
        RunEvent::UserPromptCommitted { turn, text } => SessionItemDraft::UserMessage {
            turn: *turn,
            text: text.clone(),
        },
        RunEvent::AssistantFinalized { turn, blocks } => SessionItemDraft::AssistantMessage {
            turn: *turn,
            blocks: blocks.clone(),
        },
        RunEvent::ToolInvocationRecorded {
            turn,
            tool_use_id,
            name,
            input,
        } => SessionItemDraft::ToolInvocation {
            turn: *turn,
            tool_use_id: tool_use_id.clone(),
            name: name.clone(),
            input: input.clone(),
        },
        RunEvent::ToolOutcomeRecorded {
            turn,
            tool_use_id,
            content,
        } => SessionItemDraft::ToolOutcome {
            turn: *turn,
            tool_use_id: tool_use_id.clone(),
            content: content.clone(),
        },
        RunEvent::CompactionApplied {
            turn,
            compaction_kind,
            compaction_save_id,
            excluded_item_ids,
            before_tokens,
            after_tokens,
        } => SessionItemDraft::Compaction {
            turn: *turn,
            compaction_kind: (*compaction_kind).into(),
            compaction_save_id: compaction_save_id.clone(),
            excluded_item_ids: excluded_item_ids.clone(),
            before_tokens: *before_tokens,
            after_tokens: *after_tokens,
        },
        other => {
            return Err(anyhow!(
                "run event is not committable: {}",
                non_committable_label(other)
            ));
        }
    };

    store.commit_item(draft)
}

fn non_committable_label(event: &RunEvent) -> &'static str {
    match event {
        RunEvent::RunStarted { .. } => "RunStarted",
        RunEvent::RunEnded { .. } => "RunEnded",
        RunEvent::TurnStarted { .. } => "TurnStarted",
        RunEvent::TurnEnded { .. } => "TurnEnded",
        RunEvent::LlmCallStarted { .. } => "LlmCallStarted",
        RunEvent::LlmCallEnded { .. } => "LlmCallEnded",
        RunEvent::MessageUpdate { .. } => "MessageUpdate",
        RunEvent::CompactionRecommended { .. } => "CompactionRecommended",
        RunEvent::ContextPreflightEnded { .. } => "ContextPreflightEnded",
        RunEvent::ContextPostflightEnded { .. } => "ContextPostflightEnded",
        RunEvent::UserPromptCommitted { .. }
        | RunEvent::AssistantFinalized { .. }
        | RunEvent::ToolInvocationRecorded { .. }
        | RunEvent::ToolOutcomeRecorded { .. }
        | RunEvent::CompactionApplied { .. } => "committable",
    }
}

impl From<crate::event::RunCompactionKind> for CompactionKind {
    fn from(kind: crate::event::RunCompactionKind) -> Self {
        match kind {
            crate::event::RunCompactionKind::Prune => CompactionKind::Prune,
            crate::event::RunCompactionKind::TailWindow => CompactionKind::TailWindow,
            crate::event::RunCompactionKind::Summary => CompactionKind::Summary,
        }
    }
}
