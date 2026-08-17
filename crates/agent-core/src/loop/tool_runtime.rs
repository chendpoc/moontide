use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    path::Path,
    pin::Pin,
    sync::Arc,
};

use anyhow::{bail, Result};
use tokio_util::sync::CancellationToken;

use crate::tools::{
    ToolCall, ToolCancellationReason, ToolContent, ToolRegistry, ToolResult, ToolResultStatus,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolPermission {
    Allow,
    Ask,
}

pub type ToolPermissionMap = BTreeMap<String, ToolPermission>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolApproval {
    Approved,
    Denied { reason: String },
    Cancelled,
}

pub trait ToolApprovalHandler: Send + Sync {
    fn request<'a>(
        &'a self,
        call: &'a ToolCall,
    ) -> Pin<Box<dyn Future<Output = Result<ToolApproval>> + Send + 'a>>;
}

pub struct ToolRuntime {
    pub(crate) registry: ToolRegistry,
    #[allow(dead_code, reason = "R2 will consume permission decisions")]
    pub(crate) permissions: ToolPermissionMap,
    #[allow(dead_code, reason = "R2 will consume approval decisions")]
    pub(crate) approval: Option<Arc<dyn ToolApprovalHandler>>,
}

pub(crate) enum ToolCallOutcome {
    Result(ToolResult),
    Abort {
        result: ToolResult,
        error: Option<anyhow::Error>,
    },
}

impl ToolRuntime {
    pub fn new(
        registry: ToolRegistry,
        permissions: ToolPermissionMap,
        approval: Option<Arc<dyn ToolApprovalHandler>>,
    ) -> Result<Self> {
        let registry_names = registry
            .iter()
            .map(|tool| tool.spec().name().to_owned())
            .collect::<BTreeSet<_>>();
        let permission_names = permissions.keys().cloned().collect::<BTreeSet<_>>();

        if registry_names != permission_names {
            bail!(
                "tool permission keys must match registry names exactly: registry={registry_names:?}, permissions={permission_names:?}"
            );
        }
        if permissions
            .values()
            .any(|permission| matches!(permission, ToolPermission::Ask))
            && approval.is_none()
        {
            bail!("an approval handler is required when a tool permission is Ask");
        }

        Ok(Self {
            registry,
            permissions,
            approval,
        })
    }

    pub(crate) async fn execute_call(
        &self,
        call: &ToolCall,
        working_dir: &Path,
        cancellation: &CancellationToken,
    ) -> ToolCallOutcome {
        if cancellation.is_cancelled() {
            return ToolCallOutcome::Abort {
                result: ToolResult::with_status(
                    call,
                    ToolResultStatus::Cancelled {
                        reason: ToolCancellationReason::User,
                    },
                    ToolContent::Text("tool call cancelled before execution".into()),
                ),
                error: None,
            };
        }
        let Some(tool) = self.registry.resolve(call.name()) else {
            return ToolCallOutcome::Result(ToolResult::with_status(
                call,
                ToolResultStatus::UnknownTool,
                ToolContent::Text(format!("unknown tool: {}", call.name())),
            ));
        };

        if let Err(message) = self.registry.validate_input(tool, call) {
            return ToolCallOutcome::Result(ToolResult::with_status(
                call,
                ToolResultStatus::InvalidArguments,
                ToolContent::Text(message),
            ));
        }

        let Some(permission) = self.permissions.get(call.name()) else {
            return ToolCallOutcome::Result(ToolResult::with_status(
                call,
                ToolResultStatus::Denied,
                ToolContent::Text("tool permission is not configured".into()),
            ));
        };

        if matches!(permission, ToolPermission::Ask) {
            let Some(approval) = self.approval.as_ref() else {
                return ToolCallOutcome::Result(ToolResult::with_status(
                    call,
                    ToolResultStatus::Denied,
                    ToolContent::Text("tool approval is unavailable".into()),
                ));
            };
            let approval_result = tokio::select! {
                biased;
                _ = cancellation.cancelled() => None,
                result = approval.request(call) => Some(result),
            };
            let Some(approval_result) = approval_result else {
                return ToolCallOutcome::Abort {
                    result: ToolResult::with_status(
                        call,
                        ToolResultStatus::Cancelled {
                            reason: ToolCancellationReason::User,
                        },
                        ToolContent::Text("tool approval cancelled".into()),
                    ),
                    error: None,
                };
            };
            match approval_result {
                Ok(ToolApproval::Approved) => {}
                Ok(ToolApproval::Denied { reason }) => {
                    return ToolCallOutcome::Result(ToolResult::with_status(
                        call,
                        ToolResultStatus::Denied,
                        ToolContent::Text(reason),
                    ));
                }
                Ok(ToolApproval::Cancelled) => {
                    return ToolCallOutcome::Abort {
                        result: ToolResult::with_status(
                            call,
                            ToolResultStatus::Cancelled {
                                reason: ToolCancellationReason::User,
                            },
                            ToolContent::Text("tool approval cancelled".into()),
                        ),
                        error: None,
                    };
                }
                Err(error) => {
                    return ToolCallOutcome::Abort {
                        result: ToolResult::with_status(
                            call,
                            ToolResultStatus::Cancelled {
                                reason: ToolCancellationReason::Disposed,
                            },
                            ToolContent::Text("tool approval handler failed".into()),
                        ),
                        error: Some(error),
                    };
                }
            }
        }

        if cancellation.is_cancelled() {
            return ToolCallOutcome::Abort {
                result: ToolResult::with_status(
                    call,
                    ToolResultStatus::Cancelled {
                        reason: ToolCancellationReason::User,
                    },
                    ToolContent::Text("tool call cancelled before execution".into()),
                ),
                error: None,
            };
        }
        let execution = tokio::select! {
            biased;
            _ = cancellation.cancelled() => None,
            result = tool.execute(call, working_dir) => Some(result),
        };
        match execution {
            None => ToolCallOutcome::Abort {
                result: ToolResult::outcome_unknown(
                    call,
                    ToolContent::Text("tool execution outcome is unknown".into()),
                ),
                error: None,
            },
            Some(Ok(result)) => ToolCallOutcome::Result(result),
            Some(Err(error)) => ToolCallOutcome::Abort {
                result: ToolResult::outcome_unknown(
                    call,
                    ToolContent::Text("tool execution outcome is unknown".into()),
                ),
                error: Some(error),
            },
        }
    }
}
