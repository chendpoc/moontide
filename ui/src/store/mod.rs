pub mod event_store;
pub mod status_store;

use anyhow::Result;

use event_store::EventStore;
use status_store::StatusStore;

pub struct SharedStores {
    pub events: EventStore,
    pub status: StatusStore,
}

pub fn reload_all(stores: &mut SharedStores) -> Result<()> {
    stores.events.load_initial()?;
    stores.status.reload()?;
    Ok(())
}
