use anyhow::Result;

use crate::event::TurnEvent;

use super::store::SessionStore;
use super::types::{CompactionKind, SessionItem, SessionItemDraft};

/// Maps a `TurnEvent` fact to a `SessionItem` and persists it.
pub fn commit_from_event<'a>(
    store: &'a mut SessionStore,
    event: &TurnEvent,
) -> Result<&'a SessionItem> {
    let draft = match event {
        TurnEvent::UserPromptCommitted { turn, text } => SessionItemDraft::UserMessage {
            turn: *turn,
            text: text.clone(),
        },
        TurnEvent::AssistantFinalized { turn, blocks } => SessionItemDraft::AssistantMessage {
            turn: *turn,
            blocks: blocks.clone(),
        },
        TurnEvent::ToolCallRecorded { turn, call } => SessionItemDraft::ToolCall {
            turn: *turn,
            call: call.clone(),
        },
        TurnEvent::ToolResultRecorded { turn, result } => SessionItemDraft::ToolResult {
            turn: *turn,
            result: result.clone(),
        },
        TurnEvent::CompactionApplied {
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
    };

    store.commit_item(draft)
}

impl From<crate::event::TurnCompactionKind> for CompactionKind {
    fn from(kind: crate::event::TurnCompactionKind) -> Self {
        match kind {
            crate::event::TurnCompactionKind::Prune => CompactionKind::Prune,
            crate::event::TurnCompactionKind::TailWindow => CompactionKind::TailWindow,
            crate::event::TurnCompactionKind::Summary => CompactionKind::Summary,
        }
    }
}
