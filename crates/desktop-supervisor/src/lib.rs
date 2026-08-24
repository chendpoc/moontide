//! Child-process ownership for the Tauri shell and a future standalone supervisor.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, Notify, RwLock};

#[cfg(unix)]
const UNIX_SOCKET_PATH_LIMIT: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChildRole {
    AgentHost,
    PluginHost,
    McpServer,
    ToolWorker,
}

impl ChildRole {
    fn slug(&self) -> &'static str {
        match self {
            Self::AgentHost => "agent-host",
            Self::PluginHost => "plugin-host",
            Self::McpServer => "mcp-server",
            Self::ToolWorker => "tool-worker",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProcessId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LocalEndpoint {
    #[cfg(unix)]
    UnixSocket(PathBuf),
    #[cfg(windows)]
    NamedPipe(String),
}

impl LocalEndpoint {
    #[cfg(unix)]
    pub fn unix_socket(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        if path.as_os_str().to_string_lossy().len() > UNIX_SOCKET_PATH_LIMIT {
            bail!(
                "unix socket path is too long (limit {UNIX_SOCKET_PATH_LIMIT} bytes): {}",
                path.display()
            );
        }
        Ok(Self::UnixSocket(path))
    }

    #[cfg(unix)]
    pub fn path(&self) -> &Path {
        match self {
            Self::UnixSocket(path) => path,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProcessSpec {
    pub id: ProcessId,
    pub role: ChildRole,
    pub executable: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: Option<PathBuf>,
    pub endpoint: LocalEndpoint,
}

impl ProcessSpec {
    pub fn new(
        id: impl Into<String>,
        role: ChildRole,
        executable: impl Into<PathBuf>,
        endpoint: LocalEndpoint,
    ) -> Self {
        Self {
            id: ProcessId(id.into()),
            role,
            executable: executable.into(),
            args: Vec::new(),
            cwd: None,
            endpoint,
        }
    }

    pub fn arg(mut self, arg: impl Into<OsString>) -> Self {
        self.args.push(arg.into());
        self
    }

    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }

    pub fn cwd(mut self, cwd: impl Into<PathBuf>) -> Self {
        self.cwd = Some(cwd.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessState {
    Starting,
    Running,
    Exited { code: Option<i32> },
    Killed,
    Failed { message: String },
}

struct ProcessInner {
    child: Mutex<Child>,
    kill_requested: AtomicBool,
    state: RwLock<ProcessState>,
    stopped: Notify,
}

#[derive(Clone)]
pub struct ProcessHandle {
    id: ProcessId,
    role: ChildRole,
    endpoint: LocalEndpoint,
    inner: Arc<ProcessInner>,
}

impl std::fmt::Debug for ProcessHandle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProcessHandle")
            .field("id", &self.id)
            .field("role", &self.role)
            .field("endpoint", &self.endpoint)
            .finish_non_exhaustive()
    }
}

impl ProcessHandle {
    pub fn id(&self) -> &ProcessId {
        &self.id
    }

    pub fn role(&self) -> &ChildRole {
        &self.role
    }

    pub fn endpoint(&self) -> &LocalEndpoint {
        &self.endpoint
    }

    pub async fn state(&self) -> ProcessState {
        self.inner.state.read().await.clone()
    }

    pub async fn wait(&self) -> ProcessState {
        loop {
            let state = self.state().await;
            if matches!(
                state,
                ProcessState::Exited { .. } | ProcessState::Killed | ProcessState::Failed { .. }
            ) {
                return state;
            }
            self.inner.stopped.notified().await;
        }
    }

    /// Escalation operation used only after the child protocol shutdown deadline expires.
    pub async fn kill(&self) -> Result<()> {
        self.inner.kill_requested.store(true, Ordering::Release);
        let mut child = self.inner.child.lock().await;
        let result = child
            .kill()
            .await
            .with_context(|| format!("kill {} child {}", self.role.slug(), self.id.0));
        if let Err(error) = result {
            self.inner.kill_requested.store(false, Ordering::Release);
            *self.inner.state.write().await = ProcessState::Failed {
                message: error.to_string(),
            };
            self.inner.stopped.notify_waiters();
            return Err(error);
        }
        Ok(())
    }
}

pub struct ProcessSupervisor {
    runtime_dir: PathBuf,
    next_endpoint: AtomicU64,
    children: RwLock<BTreeMap<ProcessId, ProcessHandle>>,
}

impl std::fmt::Debug for ProcessSupervisor {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProcessSupervisor")
            .field("runtime_dir", &self.runtime_dir)
            .finish_non_exhaustive()
    }
}

impl ProcessSupervisor {
    pub fn new(runtime_dir: impl Into<PathBuf>) -> Self {
        Self {
            runtime_dir: runtime_dir.into(),
            next_endpoint: AtomicU64::new(1),
            children: RwLock::new(BTreeMap::new()),
        }
    }

    pub fn runtime_dir(&self) -> &Path {
        &self.runtime_dir
    }

    #[cfg(unix)]
    pub fn allocate_unix_endpoint(&self, role: ChildRole) -> Result<LocalEndpoint> {
        std::fs::create_dir_all(&self.runtime_dir).with_context(|| {
            format!(
                "create process runtime directory {}",
                self.runtime_dir.display()
            )
        })?;
        let sequence = self.next_endpoint.fetch_add(1, Ordering::Relaxed);
        let filename = format!("{}-{}-{}.sock", role.slug(), std::process::id(), sequence);
        LocalEndpoint::unix_socket(self.runtime_dir.join(filename))
    }

    pub async fn spawn(&self, spec: ProcessSpec) -> Result<ProcessHandle> {
        if spec.id.0.trim().is_empty() {
            bail!("process id must not be empty");
        }
        if self.children.read().await.contains_key(&spec.id) {
            bail!("process id already exists: {}", spec.id.0);
        }

        let mut command = Command::new(&spec.executable);
        command.args(&spec.args);
        if let Some(cwd) = &spec.cwd {
            command.current_dir(cwd);
        }
        let child = command.spawn().with_context(|| {
            format!(
                "spawn {} child {} from {}",
                spec.role.slug(),
                spec.id.0,
                spec.executable.display()
            )
        })?;

        let inner = Arc::new(ProcessInner {
            child: Mutex::new(child),
            kill_requested: AtomicBool::new(false),
            state: RwLock::new(ProcessState::Running),
            stopped: Notify::new(),
        });
        let handle = ProcessHandle {
            id: spec.id.clone(),
            role: spec.role.clone(),
            endpoint: spec.endpoint,
            inner: Arc::clone(&inner),
        };
        self.children
            .write()
            .await
            .insert(spec.id.clone(), handle.clone());

        tokio::spawn(async move {
            let result = inner.child.lock().await.wait().await;
            let next_state = match result {
                Ok(_status) if inner.kill_requested.load(Ordering::Acquire) => ProcessState::Killed,
                Ok(status) if status.success() => ProcessState::Exited {
                    code: status.code(),
                },
                Ok(status) => ProcessState::Exited {
                    code: status.code(),
                },
                Err(error) => ProcessState::Failed {
                    message: error.to_string(),
                },
            };
            *inner.state.write().await = next_state;
            inner.stopped.notify_waiters();
        });

        Ok(handle)
    }

    pub async fn get(&self, id: &ProcessId) -> Option<ProcessHandle> {
        self.children.read().await.get(id).cloned()
    }

    pub async fn remove(&self, id: &ProcessId) -> Option<ProcessHandle> {
        self.children.write().await.remove(id)
    }

    pub async fn shutdown_all(&self) -> Vec<(ProcessId, Result<()>)> {
        let handles = self
            .children
            .read()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut results = Vec::with_capacity(handles.len());
        for handle in handles {
            if matches!(
                handle.state().await,
                ProcessState::Exited { .. } | ProcessState::Killed | ProcessState::Failed { .. }
            ) {
                continue;
            }
            let result = handle.kill().await;
            results.push((handle.id.clone(), result));
        }
        results
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // 场景：supervisor 为 AgentHost 角色分配本地 endpoint。
    // 预期：endpoint 位于明确 runtime directory，且每次 allocation 唯一。
    // 不变量：supervisor 不删除 runtime directory，也不复用未知存活的 socket path。
    #[cfg(unix)]
    #[test]
    fn unix_endpoints_are_unique_and_scoped() {
        let root = TempDir::new().expect("tempdir");
        let supervisor = ProcessSupervisor::new(root.path());
        let first = supervisor
            .allocate_unix_endpoint(ChildRole::AgentHost)
            .expect("first endpoint");
        let second = supervisor
            .allocate_unix_endpoint(ChildRole::AgentHost)
            .expect("second endpoint");

        assert_ne!(first, second);
        assert!(first.path().starts_with(root.path()));
        assert!(second.path().starts_with(root.path()));
    }

    // 场景：supervisor 启动一个立即退出的 Unix child。
    // 预期：child 被登记、退出状态可观察，且不会被错误标记为 Running。
    // 不变量：非零退出只产生 Exited 状态，不自动重放任何业务请求。
    #[cfg(unix)]
    #[tokio::test]
    async fn child_exit_is_observable() {
        let root = TempDir::new().expect("tempdir");
        let supervisor = ProcessSupervisor::new(root.path());
        let endpoint = supervisor
            .allocate_unix_endpoint(ChildRole::ToolWorker)
            .expect("endpoint");
        let handle = supervisor
            .spawn(
                ProcessSpec::new("worker-1", ChildRole::ToolWorker, "/bin/sh", endpoint)
                    .args(["-c", "exit 7"]),
            )
            .await
            .expect("child should spawn");

        assert_eq!(handle.state().await, ProcessState::Running);
        assert_eq!(handle.wait().await, ProcessState::Exited { code: Some(7) });
        assert!(supervisor.get(handle.id()).await.is_some());
    }

    // 场景：同一 process identity 被重复登记。
    // 预期：第二次 spawn 在创建 OS child 前失败。
    // 不变量：一个 supervisor 内 process id 唯一，避免错误路由 command/event。
    #[cfg(unix)]
    #[tokio::test]
    async fn duplicate_process_id_is_rejected() {
        let root = TempDir::new().expect("tempdir");
        let supervisor = ProcessSupervisor::new(root.path());
        let first_endpoint = supervisor
            .allocate_unix_endpoint(ChildRole::ToolWorker)
            .expect("endpoint");
        supervisor
            .spawn(ProcessSpec::new(
                "worker-1",
                ChildRole::ToolWorker,
                "/bin/sh",
                first_endpoint,
            ))
            .await
            .expect("first child should spawn");

        let second_endpoint = supervisor
            .allocate_unix_endpoint(ChildRole::ToolWorker)
            .expect("endpoint");
        let error = supervisor
            .spawn(ProcessSpec::new(
                "worker-1",
                ChildRole::ToolWorker,
                "/bin/sh",
                second_endpoint,
            ))
            .await
            .expect_err("duplicate id should fail");
        assert!(error.to_string().contains("process id already exists"));
        supervisor.shutdown_all().await;
    }
}
