use std::time::Duration;

pub(crate) fn retry_delay(retry_index: u32) -> Duration {
    match retry_index {
        0 => Duration::from_millis(500),
        1 => Duration::from_secs(1),
        _ => Duration::from_secs(2),
    }
}
