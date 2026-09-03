use std::sync::Arc;

use agent_core::event::{
    EventDispatcher,
    PipelineRegistry,
    TraceContext,
};
use agent_core::llm::LLMProvider;
use agent_core::llm::adapter::build_provider;
use agent_core::r#loop::{
    AgentLoop,
    AgentLoopInit,
    ToolRuntime,
};
use agent_core::session::SessionStore;
use agent_core::tools::ToolRegistry;
use agent_tools::builtin_tool_definitions;
use anyhow::{
    Context,
    Result,
};
use uuid::Uuid;

use crate::agent::AgentParts;
use crate::config::AgentConfig;
use crate::progress::ProgressHook;
use crate::prompt;

pub(crate) fn create(config: &AgentConfig) -> Result<AgentParts> {
    build(config, None)
}

pub(crate) fn resume(config: &AgentConfig, session_id: &str) -> Result<AgentParts> {
    build(config, Some(session_id))
}

pub(crate) fn ensure_runtime() -> Result<()> {
    tokio::runtime::Handle::try_current()
        .map(|_| ())
        .context("Agent create/resume/reload requires a Tokio runtime")
}

fn build(config: &AgentConfig, session_id: Option<&str>) -> Result<AgentParts> {
    ensure_runtime()?;
    config.validate_values()?;
    config.ensure_paths()?;

    let adapter_config = agent_core::llm::adapter::AdapterConfig::from_resolved(
        &config.provider.profile,
        config.provider.base_url.clone(),
        config.provider.api_key.clone(),
    );
    let provider = build_provider(adapter_config)
        .map_err(anyhow::Error::new)
        .context("build configured LLM provider")?;
    let provider: Arc<dyn LLMProvider> = Arc::from(provider);

    let registry = build_tool_registry(config)?;
    let tools = ToolRuntime::new(
        registry,
        config.permissions.clone(),
        config.approval.clone(),
    )
    .context("build tool runtime")?;

    let run_id = Uuid::new_v4().to_string();
    let mut pipeline_builder = PipelineRegistry::builder();
    let agent_event_log_handle =
        if config.persistence.diagnostic == crate::config::DiagnosticPersistence::Off {
            None
        } else {
            let (hook, handle) = build_agent_event_log(config, &run_id)?;
            pipeline_builder = pipeline_builder.hook(Arc::new(hook));
            Some(handle)
        };
    let progress_handle = if let Some(observer) = config.progress.clone() {
        let (hook, handle) = ProgressHook::new(observer)?;
        pipeline_builder = pipeline_builder.hook(Arc::new(hook));
        Some(handle)
    } else {
        None
    };
    let pipelines = pipeline_builder
        .build_frozen()
        .context("freeze event hook registry")?;

    let session = match session_id {
        Some(session_id) => SessionStore::load(&config.sessions_dir, session_id)
            .with_context(|| format!("load session {session_id}"))?,
        None => SessionStore::create(&config.sessions_dir, config.cwd.clone())
            .context("create session")?,
    };
    let stable_session_id = session.header().session_id.clone();
    let cwd = session.header().cwd.clone();
    prompt::validate_project_instructions(&cwd).context("validate project instructions")?;
    let events = EventDispatcher::new(pipelines, TraceContext::new(run_id, &stable_session_id));
    let loop_ = AgentLoop::new(AgentLoopInit {
        session,
        provider,
        tools,
        events,
    });

    Ok(AgentParts {
        loop_,
        session_id: stable_session_id,
        cwd,
        agent_event_log_handle,
        progress_handle,
    })
}

fn build_agent_event_log(
    config: &AgentConfig,
    run_id: &str,
) -> Result<(
    agent_core::event::DeriveAgentEventHook<crate::log::QueuedAgentEventRecorder>,
    crate::log::AgentEventLogHandle,
)> {
    let (queued, receiver) =
        crate::log::QueuedAgentEventRecorder::new(config.persistence.diagnostic);
    let status = queued.status();
    let recorder = match crate::log::FileAgentEventRecorder::new(&config.runs_dir, run_id) {
        Ok(recorder) => recorder,
        Err(error) => {
            let handle = crate::log::AgentEventLogHandle::failed(
                &queued,
                format!("create Agent Event Log recorder: {error:#}"),
            );
            return Ok((agent_core::event::DeriveAgentEventHook::new(queued), handle));
        }
    };
    let worker = match crate::log::AgentEventLogWorker::start(receiver, recorder, status) {
        Ok(worker) => worker,
        Err(error) => {
            let handle = crate::log::AgentEventLogHandle::failed(
                &queued,
                format!("create Agent Event Log worker: {error:#}"),
            );
            return Ok((agent_core::event::DeriveAgentEventHook::new(queued), handle));
        }
    };
    let handle = crate::log::AgentEventLogHandle::new(&queued, worker);
    Ok((agent_core::event::DeriveAgentEventHook::new(queued), handle))
}

fn build_tool_registry(config: &AgentConfig) -> Result<ToolRegistry> {
    let mut tools = Vec::with_capacity(config.tool_names.len());
    for name in &config.tool_names {
        let definition = builtin_tool_definitions()
            .iter()
            .find(|definition| definition.name() == name)
            .with_context(|| format!("unknown builtin tool: {name}"))?;
        tools.push(definition.build()?);
    }
    ToolRegistry::new(tools).context("build tool registry")
}
