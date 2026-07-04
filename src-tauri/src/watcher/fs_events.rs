use crate::error::AppError;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

pub struct RepoWatcher {
    watcher: RecommendedWatcher,
}

impl RepoWatcher {
    /// Create a new watcher for `repo_path`. Calls `callback` for each
    /// debounced filesystem event that affects the working tree (not .git/).
    pub fn new<F>(repo_path: PathBuf, callback: F) -> Result<Self, AppError>
    where
        F: Fn(Event) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

        let mut watcher = notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        })
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;

        watcher
            .watch(&repo_path, RecursiveMode::Recursive)
            .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;

        // Spawn a debounce thread
        std::thread::spawn(move || {
            let debounce = Duration::from_millis(100);
            let mut pending: Option<Event> = None;
            let mut last_received = std::time::Instant::now();

            loop {
                match rx.recv_timeout(debounce) {
                    Ok(Ok(event)) => {
                        // Ignore events inside directories that don't affect git
                        // status (`.git` internals) or that produce high-volume
                        // noise (dependency/build output). git status never
                        // reports ignored paths, so watching them wastes cycles.
                        const IGNORED_DIRS: [&str; 6] =
                            [".git", "node_modules", "target", "dist", ".next", "build"];
                        let is_ignored = event.paths.iter().all(|p| {
                            p.components().any(|c| {
                                IGNORED_DIRS.contains(&c.as_os_str().to_string_lossy().as_ref())
                            })
                        });

                        if !is_ignored {
                            pending = Some(event);
                            last_received = std::time::Instant::now();
                        }
                    }
                    Ok(Err(e)) => {
                        tracing::error!("Watcher error: {}", e);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        // Fire debounced event if we have one and enough time passed
                        if let Some(event) = pending.take() {
                            if last_received.elapsed() >= debounce {
                                callback(event);
                            } else {
                                pending = Some(event);
                            }
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        // Channel closed — sender dropped, exit thread
                        break;
                    }
                }
            }
        });

        Ok(RepoWatcher { watcher })
    }

    /// Stop watching by dropping the watcher (unregisters FSEvents handler).
    pub fn stop(self) {
        drop(self.watcher);
    }
}
