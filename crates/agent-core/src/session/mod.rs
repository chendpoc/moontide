//! Session Item Log — append-only fact source for a conversation.

mod commit;
mod commit_handler;
mod file_store;
mod store;
mod types;

#[cfg(test)]
mod tests;

pub use commit::commit_from_event;
pub use commit_handler::SessionCommitHandler;
pub use store::SessionStore;
pub use types::{
    CompactionKind, SessionHeader, SessionItem, SessionItemBase, SessionItemDraft,
    SESSION_HEADER_VERSION,
};
