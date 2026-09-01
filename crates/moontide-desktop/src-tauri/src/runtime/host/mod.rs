use std::sync::{Arc, Mutex};

use anyhow::{bail, Context, Result};
use tokio::sync::mpsc;

use super::approval::ApprovalBroker;
use super::command::HostCommand;
use super::event::{DesktopEvent, DesktopEventStream, EventBuffer};
use super::state::DesktopRunState;

mod actor;
mod handle;
mod progress;
#[cfg(test)]
mod tests;

use actor::HostActor;
use progress::ProgressSink;

const COMMAND_CAPACITY: usize = 32;
pub(crate) const MIN_EVENT_CAPACITY: usize = 16;

pub struct DesktopConfig {
    pub agent: agent::AgentConfig,
    pub session: SessionSelection,
    pub event_capacity: usize,
}

pub enum SessionSelection {
    New,
    Existing(String),
}

pub struct DesktopHost;

#[derive(Clone)]
pub struct DesktopHostHandle {
    sender: mpsc::Sender<HostCommand>,
}

impl DesktopHost {
    pub async fn start(config: DesktopConfig) -> Result<(DesktopHostHandle, DesktopEventStream)> {
        if config.event_capacity < MIN_EVENT_CAPACITY {
            bail!("event_capacity must be at least {MIN_EVENT_CAPACITY}");
        }

        let query = agent::SessionQuery::new(config.agent.sessions_dir.clone());
        let next_turn = match &config.session {
            SessionSelection::New => 0,
            SessionSelection::Existing(session_id) => query
                .load(session_id)
                .with_context(|| format!("load session {session_id} for Desktop host"))?
                .summary
                .last_turn
                .map_or(0, |turn| turn.saturating_add(1)),
        };

        let buffer = EventBuffer::new(config.event_capacity);
        let shared_state = Arc::new(Mutex::new(DesktopRunState::Starting));
        let mut agent_config = config.agent;
        let session_id_hint = match &config.session {
            SessionSelection::New => String::new(),
            SessionSelection::Existing(session_id) => session_id.clone(),
        };
        let session_identity = Arc::new(Mutex::new(session_id_hint.clone()));
        let broker = Arc::new(ApprovalBroker::new(
            agent_config.cwd.clone(),
            session_id_hint,
            Arc::clone(&shared_state),
            Arc::clone(&buffer),
        ));
        agent_config.approval = Some(Arc::clone(&broker) as Arc<dyn agent::ToolApprovalHandler>);
        agent_config.progress = Some(Arc::new(ProgressSink {
            session_id: Arc::clone(&session_identity),
            shared_state: Arc::clone(&shared_state),
            buffer: Arc::clone(&buffer),
        }));

        let agent = match config.session {
            SessionSelection::New => agent::Agent::create(agent_config),
            SessionSelection::Existing(session_id) => {
                agent::Agent::resume(agent_config, &session_id)
            }
        }?;
        let session_id = agent.session_id().to_owned();
        *session_identity
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = session_id.clone();
        broker.set_session_id(session_id.clone());
        let _ = buffer.publish(
            &session_id,
            DesktopEvent::StateChanged {
                state: DesktopRunState::Idle,
            },
        );
        *shared_state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = DesktopRunState::Idle;
        let (sender, receiver) = mpsc::channel(COMMAND_CAPACITY);
        let actor = HostActor {
            agent: Some(agent),
            session_id,
            query,
            broker,
            buffer: Arc::clone(&buffer),
            shared_state,
            receiver,
            state: DesktopRunState::Idle,
            next_turn,
            active: None,
        };
        tokio::spawn(actor.run());

        Ok((
            DesktopHostHandle { sender },
            DesktopEventStream::new(buffer),
        ))
    }
}
