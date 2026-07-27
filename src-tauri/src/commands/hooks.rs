// SPDX-License-Identifier: GPL-3.0-or-later
//! Claude Code hook collection — V28's plumbing.
//!
//! Two rules govern this file:
//!
//! - **Install is a click, never a side effect.** `~/.claude/settings.json` is
//!   the user's file. [`install_verify_hooks`] and [`uninstall_verify_hooks`]
//!   may only be reached from an explicit confirmation, and
//!   [`preview_hook_install`] exists so that confirmation can show the exact
//!   bytes first.
//! - **A probe never toasts.** [`get_hook_status`] cannot fail; a missing or
//!   malformed settings file is a *state*, not an error.
//!
//! `v28.hookCollector` stays `Planned` in the registry: the hook is a collection
//! path, not a rule, and it emits no `Finding` of its own. What it feeds is
//! V19–V27, which already consume `SessionSummary` — so
//! [`list_hook_sessions`] returns the same type `commands/session.rs` does and
//! nothing downstream can tell the two sources apart.

use std::path::PathBuf;

use crate::error::AppError;
use crate::verify::hooks::{self, HookChange, HookPaths, HookPreview, HookStatus};
use crate::verify::types::SessionSummary;

#[tauri::command]
pub async fn get_hook_status() -> Result<HookStatus, AppError> {
    tokio::task::spawn_blocking(|| hooks::status(&HookPaths::from_home()))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))
}

/// The exact settings fragment, the exact script body, and the full list of
/// fields the log will record. Writes nothing.
#[tauri::command]
pub async fn preview_hook_install() -> Result<HookPreview, AppError> {
    tokio::task::spawn_blocking(|| hooks::preview(&HookPaths::from_home()))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))
}

/// Explicit opt-in only. The caller must have shown [`preview_hook_install`].
#[tauri::command]
pub async fn install_verify_hooks() -> Result<HookChange, AppError> {
    tokio::task::spawn_blocking(|| {
        tracing::info!("[verify] installing Claude Code hooks");
        hooks::install(&HookPaths::from_home())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[tauri::command]
pub async fn uninstall_verify_hooks() -> Result<HookChange, AppError> {
    tokio::task::spawn_blocking(|| {
        tracing::info!("[verify] removing Claude Code hooks");
        hooks::uninstall(&HookPaths::from_home())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// Sessions reconstructed from the hook event log, pruned to the retention
/// window first. Same shape as the session-file reader, on purpose.
#[tauri::command]
pub async fn list_hook_sessions(
    repo_path: Option<String>,
) -> Result<Vec<SessionSummary>, AppError> {
    tokio::task::spawn_blocking(move || {
        let log_dir = HookPaths::from_home().log_dir();
        let removed = hooks::prune_event_log(&log_dir, hooks::LOG_RETENTION_DAYS);
        if removed > 0 {
            tracing::debug!("[verify] pruned {} expired hook log file(s)", removed);
        }
        let repo = repo_path.as_deref().map(PathBuf::from);
        hooks::summarize_hook_sessions(&log_dir, repo.as_deref())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))
}
