use anyhow::Result;

use super::TurnEvent;

/// Persists a turn fact to the Session Item Log.
pub trait CommitHandler: Send + Sync {
    fn commit(&self, event: &TurnEvent) -> Result<()>;
}
