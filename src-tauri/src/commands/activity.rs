use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::Emitter;

use crate::error::AppError;
use crate::events::{ActivityEvent, REPO_ACTIVITY};
use crate::watcher::activity::ActivityWatcher;

/// Holds the lazily-created activity watcher. It is created on the first
/// `set_activity_watch` call, once an `AppHandle` is available to emit from.
///
/// Wrapped in `Arc` (not just the `Mutex`) so `set_activity_watch` can clone
/// it into a `spawn_blocking` closure instead of holding the lock across a
/// blocking `notify::Watcher::watch()` call on a tokio worker thread.
#[derive(Default, Clone)]
pub struct ActivityWatcherState {
    inner: Arc<Mutex<Option<ActivityWatcher>>>,
}

impl ActivityWatcherState {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityWatchResult {
    /// Paths actually being watched, canonicalized.
    pub watched: Vec<String>,
    /// Requested paths that did not fit under the cap — the frontend falls
    /// back to polling for these.
    pub overflow: Vec<String>,
}

/// Sets the full list of paths (repositories and worktrees) to watch for
/// activity. Up to `MAX_ACTIVITY_TARGETS` (40) are actually watched; the rest
/// come back as `overflow`. Emits `repo:activity` (debounced 2s per path) when
/// something changes inside a watched path, `.git/` internals excluded.
///
/// This is independent from the active-repository watcher
/// (`commands::watch`), which keeps refreshing that repo's status.
#[tauri::command]
pub async fn set_activity_watch(
    paths: Vec<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, ActivityWatcherState>,
) -> Result<ActivityWatchResult, AppError> {
    let state = state.inner().clone();
    // notify's FSEvents backend rebuilds its whole merged stream on every
    // `watch()` call, so registering many paths is roughly O(n) in wall time
    // (measured ~2.75s for the 40-path cap — see
    // `watcher::activity::measures_the_cost_of_watching_the_full_40_path_cap`).
    // Run it off the async runtime's worker threads, like `commands::watch`
    // does for its own watcher setup, so it cannot block other commands.
    tokio::task::spawn_blocking(move || {
        let mut guard = state.inner.lock().map_err(|e| AppError::Channel(e.to_string()))?;
        if guard.is_none() {
            let handle = app_handle.clone();
            let watcher = ActivityWatcher::new(move |path, at| {
                let _ = handle.emit(
                    REPO_ACTIVITY,
                    ActivityEvent {
                        path: path.to_string_lossy().to_string(),
                        at,
                    },
                );
            })?;
            *guard = Some(watcher);
        }

        let watcher = guard.as_ref().expect("just initialized above");
        let requested: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let resolved = watcher.set_targets(&requested);

        Ok(ActivityWatchResult {
            watched: resolved.watched.into_iter().map(path_to_string).collect(),
            overflow: resolved.overflow.into_iter().map(path_to_string).collect(),
        })
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().to_string()
}
