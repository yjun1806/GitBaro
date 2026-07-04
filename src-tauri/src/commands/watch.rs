use std::sync::Mutex;

use tauri::Emitter;

use crate::error::AppError;
use crate::events::{FsChangeEvent, FS_CHANGE};
use crate::watcher::RepoWatcher;

/// Holds the single active repository watcher. Switching the active repo stops
/// the previous watcher (dropping it unregisters the FSEvents handler) and
/// starts a new one.
#[derive(Default)]
pub struct WatcherState {
    active: Mutex<Option<(String, RepoWatcher)>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Start watching `repo_path` for working-tree changes. Emits `fs:change` events
/// (debounced) that the frontend uses to refresh status without tight polling.
#[tauri::command]
pub async fn start_repo_watch(
    repo_path: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), AppError> {
    {
        let guard = state.active.lock().map_err(|e| AppError::Channel(e.to_string()))?;
        // Already watching this repo — nothing to do.
        if guard.as_ref().map(|(p, _)| p == &repo_path).unwrap_or(false) {
            return Ok(());
        }
    }

    let emit_path = repo_path.clone();
    let watcher = RepoWatcher::new(std::path::PathBuf::from(&repo_path), move |_event| {
        let _ = app_handle.emit(
            FS_CHANGE,
            FsChangeEvent {
                repo_path: emit_path.clone(),
            },
        );
    })?;

    let mut guard = state.active.lock().map_err(|e| AppError::Channel(e.to_string()))?;
    // Dropping the previous watcher stops it.
    *guard = Some((repo_path, watcher));
    Ok(())
}

/// Stop the active repository watcher, if any.
#[tauri::command]
pub async fn stop_repo_watch(state: tauri::State<'_, WatcherState>) -> Result<(), AppError> {
    let mut guard = state.active.lock().map_err(|e| AppError::Channel(e.to_string()))?;
    *guard = None;
    Ok(())
}
