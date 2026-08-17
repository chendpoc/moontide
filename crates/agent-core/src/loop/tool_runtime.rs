use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    pin::Pin,
    sync::Arc,
};

use anyhow::{bail, Result};

use crate::tools::{ToolCall, ToolRegistry};

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
}
