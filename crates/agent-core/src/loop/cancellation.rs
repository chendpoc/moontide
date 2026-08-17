use std::time::Duration;

use anyhow::{bail, Result};
use tokio_util::sync::CancellationToken;

pub(crate) async fn wait_for_retry(
    cancellation: &CancellationToken,
    delay: Duration,
) -> Result<()> {
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => bail!("turn cancelled during retry backoff"),
        _ = tokio::time::sleep(delay) => Ok(()),
    }
}
