use anyhow::{
    Result,
    bail,
};
use tokio::sync::mpsc;

use super::{
    TraceContext,
    TurnEvent,
};

/// Immutable event and correlation context delivered to an asynchronous observer.
#[derive(Debug, Clone, PartialEq)]
pub struct ObserverEvent {
    pub context: TraceContext,
    pub event: TurnEvent,
}

/// Non-blocking bounded publisher for post-commit observers.
#[derive(Debug, Clone)]
pub struct ObserverBridge {
    sender: mpsc::Sender<ObserverEvent>,
}

impl ObserverBridge {
    /// Creates a bounded observer queue and its asynchronous consumer.
    pub fn channel(capacity: usize) -> Result<(Self, mpsc::Receiver<ObserverEvent>)> {
        if capacity == 0 {
            bail!("observer bridge capacity must be greater than zero");
        }
        let (sender, receiver) = mpsc::channel(capacity);
        Ok((Self { sender }, receiver))
    }

    /// Publishes without waiting; queue-full and closed-consumer failures are intentionally ignored.
    pub fn try_publish(&self, context: &TraceContext, event: &TurnEvent) {
        let _ = self.sender.try_send(ObserverEvent {
            context: context.clone(),
            event: event.clone(),
        });
    }
}
