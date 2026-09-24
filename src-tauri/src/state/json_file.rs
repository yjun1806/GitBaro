//! Crash- and race-safe persistence for the small JSON files the backend keeps
//! in the app data directory (settings, repo↔account mapping, account cache,
//! window state).
//!
//! - Writes go to a temp file in the same directory and are renamed over the
//!   target, so a crash mid-write never leaves a truncated file behind.
//! - Read-modify-write sequences hold [`lock`] so two concurrent updates cannot
//!   drop each other's changes.
//! - A file that exists but fails to parse is reported as an error instead of
//!   being treated as empty, so callers never overwrite user data by accident.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use tokio::sync::{Mutex, MutexGuard};

use crate::error::AppError;

static STATE_FILES_LOCK: Mutex<()> = Mutex::const_new(());

/// Serialize read-modify-write of the backend's JSON state files. Hold the
/// guard across the whole load → change → save sequence. Not re-entrant.
pub async fn lock() -> MutexGuard<'static, ()> {
    STATE_FILES_LOCK.lock().await
}

/// Read a JSON file. `Ok(None)` when the file does not exist; a parse error is
/// returned as `Err` so the caller does not mistake a damaged file for an empty one.
pub async fn read_json(path: &Path) -> Result<Option<Value>, AppError> {
    match tokio::fs::read_to_string(path).await {
        Ok(contents) => Ok(Some(serde_json::from_str(&contents)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Write `value` as pretty JSON to `path` atomically (temp file + rename).
pub async fn write_json_atomic<T: Serialize + ?Sized>(
    path: &Path,
    value: &T,
) -> Result<(), AppError> {
    let contents = serde_json::to_string_pretty(value)?.into_bytes();
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || write_atomic_blocking(&path, &contents))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))?
}

fn write_atomic_blocking(path: &Path, contents: &[u8]) -> Result<(), AppError> {
    use std::io::Write;

    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(dir)?;

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "state.json".to_string());
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp = dir.join(format!(".{}.{}.{}.tmp", file_name, std::process::id(), nanos));

    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(contents)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result.map_err(AppError::Io)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gitbaro-json-file-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn missing_file_reads_as_none() {
        let dir = temp_dir("missing");
        assert!(read_json(&dir.join("nope.json")).await.unwrap().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn damaged_file_is_an_error_not_empty() {
        let dir = temp_dir("damaged");
        let path = dir.join("map.json");
        std::fs::write(&path, "{\"a\": ").unwrap();
        assert!(read_json(&path).await.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn atomic_write_replaces_and_leaves_no_temp_files() {
        let dir = temp_dir("write");
        let path = dir.join("nested").join("map.json");
        write_json_atomic(&path, &json!({"a": 1})).await.unwrap();
        write_json_atomic(&path, &json!({"a": 2, "b": 3})).await.unwrap();
        assert_eq!(read_json(&path).await.unwrap(), Some(json!({"a": 2, "b": 3})));
        let leftovers: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn concurrent_locked_updates_keep_every_key() {
        let dir = temp_dir("concurrent");
        let path = dir.join("map.json");
        let mut tasks = Vec::new();
        for i in 0..16 {
            let path = path.clone();
            tasks.push(tokio::spawn(async move {
                let _guard = lock().await;
                let current = read_json(&path).await.unwrap().unwrap_or_else(|| json!({}));
                let mut map = current.as_object().cloned().unwrap_or_default();
                map.insert(format!("k{}", i), json!(i));
                write_json_atomic(&path, &Value::Object(map)).await.unwrap();
            }));
        }
        for t in tasks {
            t.await.unwrap();
        }
        let value = read_json(&path).await.unwrap().unwrap();
        assert_eq!(value.as_object().unwrap().len(), 16);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
