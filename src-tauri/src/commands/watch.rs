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

    /// `repo_path` 를 감시 중일 때만 멈춘다.
    ///
    /// 무조건 비우면 안 된다. 프론트엔드는 활성 저장소가 바뀔 때 이전 경로에 대한
    /// 정리(stop)와 새 경로의 시작(start)을 각각 await 없이 호출한다. 두 IPC 의
    /// 도착 순서는 보장되지 않아서, 무조건 비우는 구현은 늦게 도착한 stop 이 방금
    /// 시작한 감시자를 죽인다. 그러면 파일을 고쳐도 fs:change 가 오지 않아
    /// 사이드바가 느린 폴링에만 의존하게 된다.
    fn stop_if_watching(&self, repo_path: &str) -> Result<(), AppError> {
        let mut guard = self.active.lock().map_err(|e| AppError::Channel(e.to_string()))?;
        if guard.as_ref().map(|(p, _)| p == repo_path).unwrap_or(false) {
            *guard = None;
        }
        Ok(())
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

/// Stop watching `repo_path`. 다른 경로로 이미 교체됐다면 아무것도 하지 않는다.
#[tauri::command]
pub async fn stop_repo_watch(
    repo_path: String,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), AppError> {
    state.stop_if_watching(&repo_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watch(state: &WatcherState, dir: &std::path::Path) {
        let watcher = RepoWatcher::new(dir.to_path_buf(), |_| {}).expect("감시자 생성 실패");
        *state.active.lock().unwrap() = Some((dir.to_string_lossy().to_string(), watcher));
    }

    fn watching_path(state: &WatcherState) -> Option<String> {
        state.active.lock().unwrap().as_ref().map(|(p, _)| p.clone())
    }

    /// 저장소를 전환하면 프론트엔드가 이전 경로의 stop 과 새 경로의 start 를
    /// 순서 보장 없이 함께 보낸다. start 가 먼저 도착해도 뒤늦은 stop 이 새 감시자를
    /// 죽이면 안 된다.
    #[test]
    fn late_stop_for_the_previous_path_leaves_the_new_watcher_alone() {
        let tmp = std::env::temp_dir().join(format!("gitbaro-watch-{}", std::process::id()));
        let old = tmp.join("old");
        let new = tmp.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();

        let state = WatcherState::new();
        watch(&state, &old);
        // start(new) 가 먼저 반영된 상황
        watch(&state, &new);
        // 뒤늦게 도착한 stop(old)
        state.stop_if_watching(&old.to_string_lossy()).unwrap();

        assert_eq!(watching_path(&state).as_deref(), Some(new.to_string_lossy().as_ref()));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn stops_when_the_path_matches() {
        let tmp = std::env::temp_dir().join(format!("gitbaro-watch-match-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();

        let state = WatcherState::new();
        watch(&state, &tmp);
        state.stop_if_watching(&tmp.to_string_lossy()).unwrap();

        assert_eq!(watching_path(&state), None);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn stopping_when_nothing_is_watched_is_a_no_op() {
        let state = WatcherState::new();
        state.stop_if_watching("/nowhere").unwrap();
        assert_eq!(watching_path(&state), None);
    }
}
