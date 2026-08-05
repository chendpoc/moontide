use chrono::{DateTime, Local};
use rand::Rng;
use uuid::Uuid;

pub fn format_id_timestamp(now: DateTime<Local>) -> String {
    now.format("%Y%m%d-%H%M%S").to_string()
}

/// Filesystem-safe id: `YYYYMMDD-HHmmss-<8 hex>`.
pub fn new_timestamped_id(now: DateTime<Local>) -> String {
    let mut rng = rand::rng();
    let suffix: u32 = rng.random();
    format!("{}-{:08x}", format_id_timestamp(now), suffix)
}

pub fn new_session_id() -> String {
    new_timestamped_id(Local::now())
}

pub fn new_event_id() -> String {
    Uuid::new_v4().to_string()
}
