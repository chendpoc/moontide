//! Session Item Log — append-only fact source for a conversation.

mod commit;
mod file_store;
mod store;
mod types;

#[cfg(test)]
mod tests;

pub use commit::commit_from_event;
pub use store::SessionStore;
pub use types::{
    CompactionKind, SessionHeader, SessionItem, SessionItemBase, SessionItemDraft,
    SESSION_HEADER_VERSION,
};
