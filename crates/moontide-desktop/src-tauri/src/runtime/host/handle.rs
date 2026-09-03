use super::super::command::{
    DesktopCommandError,
    HostCommand,
};
use super::super::state::{
    DesktopSnapshot,
    ShutdownReport,
};
use super::DesktopHostHandle;

impl DesktopHostHandle {
    pub async fn submit_turn(&self, text: String) -> Result<u64, DesktopCommandError> {
        let (reply, result) = oneshot_reply();
        self.sender
            .send(HostCommand::SubmitTurn { text, reply })
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?;
        result
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?
    }

    pub(crate) async fn cancel_turn_with_identity(&self) -> Result<u64, DesktopCommandError> {
        let (reply, result) = oneshot_reply();
        self.sender
            .send(HostCommand::CancelTurn { reply })
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?;
        result
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?
    }

    pub async fn approve(&self, request_id: String) -> Result<(), DesktopCommandError> {
        let (reply, result) = oneshot_reply();
        self.sender
            .send(HostCommand::Approve { request_id, reply })
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?;
        result
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?
    }

    pub async fn deny(
        &self,
        request_id: String,
        reason: String,
    ) -> Result<(), DesktopCommandError> {
        let (reply, result) = oneshot_reply();
        self.sender
            .send(HostCommand::Deny {
                request_id,
                reason,
                reply,
            })
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?;
        result
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?
    }

    pub async fn snapshot(&self) -> Result<DesktopSnapshot, DesktopCommandError> {
        let (reply, result) = oneshot_reply();
        self.sender
            .send(HostCommand::Snapshot { reply })
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?;
        result
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?
    }

    pub async fn shutdown(self) -> Result<ShutdownReport, DesktopCommandError> {
        let (reply, result) = oneshot_reply();
        self.sender
            .send(HostCommand::Shutdown { reply })
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?;
        result
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?
    }
}

fn oneshot_reply<T>() -> (
    tokio::sync::oneshot::Sender<T>,
    tokio::sync::oneshot::Receiver<T>,
) {
    tokio::sync::oneshot::channel()
}
