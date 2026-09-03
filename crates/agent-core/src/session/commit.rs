use anyhow::{
    Result,
    anyhow,
};

use super::store::SessionStore;
use super::types::{
    CompactionKind,
    SessionItem,
    SessionItemDraft,
};
use crate::event::{
    CommitHandler,
    TurnEvent,
};

/// Maps a committable `TurnEvent` to a `SessionItem` and persists it.
///
/// Empty `AssistantFinalized` markers are accepted as runtime lifecycle events
/// and intentionally do not append a Session Item.
pub fn commit_from_event<'a>(
    store: &'a mut SessionStore,
    event: &TurnEvent,
) -> Result<Option<&'a SessionItem>> {
    let draft = match event {
        TurnEvent::UserPromptCommitted { turn, text } => SessionItemDraft::UserMessage {
            turn: *turn,
            text: text.clone(),
        },
        TurnEvent::AssistantFinalized { turn, blocks, .. } => {
            if blocks.is_empty() {
                return Ok(None);
            }
            SessionItemDraft::AssistantMessage {
                turn: *turn,
                blocks: blocks.clone(),
            }
        }
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
        other => {
            return Err(anyhow!(
                "turn event is not committable: {}",
                non_committable_label(other)
            ));
        }
    };

    store.commit_item(draft).map(Some)
}

fn non_committable_label(event: &TurnEvent) -> &'static str {
    match event {
        TurnEvent::TurnStarted { .. } => "TurnStarted",
        TurnEvent::TurnEnded { .. } => "TurnEnded",
        TurnEvent::LlmCallStarted { .. } => "LlmCallStarted",
        TurnEvent::LlmCallEnded { .. } => "LlmCallEnded",
        TurnEvent::MessageUpdate { .. } => "MessageUpdate",
        TurnEvent::CompactionRecommended { .. } => "CompactionRecommended",
        TurnEvent::ContextPreflightEnded { .. } => "ContextPreflightEnded",
        TurnEvent::ContextPostflightEnded { .. } => "ContextPostflightEnded",
        TurnEvent::UserPromptCommitted { .. }
        | TurnEvent::AssistantFinalized { .. }
        | TurnEvent::ToolCallRecorded { .. }
        | TurnEvent::ToolResultRecorded { .. }
        | TurnEvent::CompactionApplied { .. } => "committable",
    }
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

impl CommitHandler for SessionStore {
    fn commit(&mut self, event: &TurnEvent) -> Result<Option<String>> {
        let item = commit_from_event(self, event)?;
        Ok(item.map(|item| item.base().id.clone()))
    }
}
