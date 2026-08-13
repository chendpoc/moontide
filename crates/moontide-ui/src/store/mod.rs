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
    stores.status.reload()?;
    let run_id = match stores.status.snapshot().run_id.as_str() {
        "" => None,
        value => Some(value.to_string()),
    };
    stores.events.set_run_id(run_id)?;
    Ok(())
}
