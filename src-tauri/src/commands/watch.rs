use std::sync::Mutex;

use tauri::Emitter;

use crate::error::AppError;
use crate::events::{FsChangeEvent, FS_CHANGE};
use crate::watcher::RepoWatcher;

/// 활성 저장소 감시자 하나를 들고 있다. 저장소를 전환하면 이전 감시자를 버리고
/// (drop 하면 FSEvents 핸들러가 해제된다) 새로 시작한다.
///
/// 감시자는 경로가 아니라 **세대 번호**로 식별한다. 프론트엔드는 저장소가 바뀔 때
/// 이전 세대의 정리(stop)와 새 세대의 시작(start)을 각각 await 없이 호출하는데,
/// 두 IPC 의 도착 순서는 보장되지 않는다. 경로로 짝을 맞추면 같은 저장소를
/// 오갔을 때(A → B → A) 오래된 stop(A) 이 새 감시자 A 를 죽인다 — 경로가 같아서
/// 구분되지 않기 때문이다. 세대 번호는 그 경우까지 구분한다.
#[derive(Default)]
pub struct WatcherState {
    active: Mutex<Option<(u64, RepoWatcher)>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self::default()
    }

    /// 감시자를 설치한다. 더 새로운 세대가 이미 자리를 잡았다면 버린다.
    fn install(&self, token: u64, watcher: RepoWatcher) -> Result<(), AppError> {
        let mut guard = self.active.lock().map_err(|e| AppError::Channel(e.to_string()))?;
        if guard.as_ref().map(|(t, _)| *t > token).unwrap_or(false) {
            return Ok(()); // 늦게 도착한 start — watcher 는 여기서 drop 된다
        }
        *guard = Some((token, watcher));
        Ok(())
    }

    /// 이 세대의 감시자일 때만 멈춘다. 이미 교체됐다면 아무것도 하지 않는다.
    fn stop(&self, token: u64) -> Result<(), AppError> {
        let mut guard = self.active.lock().map_err(|e| AppError::Channel(e.to_string()))?;
        if guard.as_ref().map(|(t, _)| *t == token).unwrap_or(false) {
            *guard = None;
        }
        Ok(())
    }
}

/// Start watching `repo_path` for working-tree changes. Emits `fs:change` events
/// (debounced) that the frontend uses to refresh status without tight polling.
///
/// `token` 은 프론트엔드가 매기는 단조 증가 세대 번호다.
#[tauri::command]
pub async fn start_repo_watch(
    repo_path: String,
    token: u64,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), AppError> {
    let emit_path = repo_path.clone();
    let watcher = RepoWatcher::new(std::path::PathBuf::from(&repo_path), move |_event| {
        let _ = app_handle.emit(
            FS_CHANGE,
            FsChangeEvent {
                repo_path: emit_path.clone(),
            },
        );
    })?;

    state.install(token, watcher)
}

/// Stop the watcher started with `token`.
#[tauri::command]
pub async fn stop_repo_watch(
    token: u64,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), AppError> {
    state.stop(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watcher() -> RepoWatcher {
        let dir = std::env::temp_dir();
        RepoWatcher::new(dir, |_| {}).expect("감시자 생성 실패")
    }

    fn current(state: &WatcherState) -> Option<u64> {
        state.active.lock().unwrap().as_ref().map(|(t, _)| *t)
    }

    #[test]
    fn installs_the_first_watcher() {
        let state = WatcherState::new();
        state.install(1, watcher()).unwrap();
        assert_eq!(current(&state), Some(1));
    }

    #[test]
    fn newer_generation_replaces_the_previous_one() {
        let state = WatcherState::new();
        state.install(1, watcher()).unwrap();
        state.install(2, watcher()).unwrap();
        assert_eq!(current(&state), Some(2));
    }

    /// 늦게 도착한 start 가 이미 자리 잡은 새 감시자를 덮어쓰면 안 된다.
    #[test]
    fn stale_start_does_not_overwrite_a_newer_watcher() {
        let state = WatcherState::new();
        state.install(5, watcher()).unwrap();
        state.install(3, watcher()).unwrap();
        assert_eq!(current(&state), Some(5));
    }

    #[test]
    fn stops_its_own_generation() {
        let state = WatcherState::new();
        state.install(7, watcher()).unwrap();
        state.stop(7).unwrap();
        assert_eq!(current(&state), None);
    }

    /// 핵심: 저장소를 A → B → A 로 오가면 같은 경로에 대한 stop 이 두 번 생긴다.
    /// 경로로 짝을 맞추면 오래된 stop 이 새 감시자를 죽인다. 세대 번호는 구분한다.
    #[test]
    fn stale_stop_does_not_kill_a_newer_watcher_for_the_same_repo() {
        let state = WatcherState::new();
        state.install(1, watcher()).unwrap(); // A
        state.install(2, watcher()).unwrap(); // B
        state.install(3, watcher()).unwrap(); // 다시 A — 경로는 1번과 같다
        state.stop(1).unwrap(); // 뒤늦게 도착한 A 의 정리

        assert_eq!(current(&state), Some(3));
    }

    #[test]
    fn stopping_an_unknown_generation_is_a_no_op() {
        let state = WatcherState::new();
        state.install(1, watcher()).unwrap();
        state.stop(99).unwrap();
        assert_eq!(current(&state), Some(1));

        let empty = WatcherState::new();
        empty.stop(1).unwrap();
        assert_eq!(current(&empty), None);
    }
}
