//! Auth state wrappers — no Tauri dependency, usable in standalone binary

use crate::proxy::providers::codex_oauth_auth::CodexOAuthManager;
use crate::proxy::providers::copilot_auth::CopilotAuthManager;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Copilot auth state wrapper
pub struct CopilotAuthState(pub Arc<RwLock<CopilotAuthManager>>);

/// Codex OAuth auth state wrapper
pub struct CodexOAuthState(pub Arc<RwLock<CodexOAuthManager>>);
