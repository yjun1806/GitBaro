//! The tiny JSON document store the review modules share.
//!
//! Two properties matter:
//!
//! - **Cheap to load.** A missing or corrupt document degrades to `Default`
//!   rather than failing, the same way `state/app_state.rs` falls back. Review
//!   state is an aid, not a source of truth — losing it must never break a
//!   screen.
//! - **Crash safe.** A write lands in a sibling temp file that is flushed and
//!   fsynced, then renamed over the target. `rename(2)` on the same filesystem
//!   is atomic, so a reader sees either the old document or the new one.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::de::DeserializeOwned;
use serde::Serialize;
use tracing::warn;

use crate::error::AppError;

/// Disambiguates temp files written concurrently by the same process.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Read a JSON document, falling back to `T::default()` when it is absent,
/// unreadable, or unparseable.
pub fn load_json<T>(path: &Path) -> T
where
    T: DeserializeOwned + Default,
{
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return T::default(),
        Err(e) => {
            warn!("[verify] could not read {:?}: {} — using defaults", path, e);
            return T::default();
        }
    };

    match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(e) => {
            warn!("[verify] could not parse {:?}: {} — using defaults", path, e);
            T::default()
        }
    }
}

/// Persist a JSON document atomically: write a temp sibling, fsync it, rename.
pub fn save_json<T>(path: &Path, value: &T) -> Result<(), AppError>
where
    T: Serialize + ?Sized,
{
    let parent = path.parent().ok_or_else(|| {
        AppError::Verify(format!("Invalid review state path: {}", path.display()))
    })?;
    std::fs::create_dir_all(parent)?;

    let json = serde_json::to_string(value)?;
    let temp = temp_sibling(path);

    if let Err(e) = write_and_sync(&temp, json.as_bytes()) {
        let _ = std::fs::remove_file(&temp);
        return Err(e);
    }

    if let Err(e) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(e.into());
    }

    Ok(())
}

fn write_and_sync(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let mut file = std::fs::File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

/// A hidden sibling of `path`, unique per process and per call.
fn temp_sibling(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("state.json");
    let unique = TEMP_COUNTER.fetch_add(1, Ordering::SeqCst);
    path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        name,
        std::process::id(),
        unique
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Serialize, Deserialize, Debug, Default, PartialEq)]
    struct Doc {
        items: Vec<String>,
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let unique = TEMP_COUNTER.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir().join(format!(
                "gitbaro-store-test-{}-{}-{}",
                tag,
                std::process::id(),
                unique
            ));
            std::fs::create_dir_all(&path).expect("create temp dir");
            TempDir(path)
        }

        fn file(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn leftovers(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .expect("read dir")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn missing_document_loads_default() {
        let dir = TempDir::new("missing");
        let doc: Doc = load_json(&dir.file("absent.json"));
        assert_eq!(doc, Doc::default());
    }

    #[test]
    fn corrupt_document_loads_default() {
        let dir = TempDir::new("corrupt");
        let path = dir.file("corrupt.json");
        std::fs::write(&path, "{ this is not json").expect("write");

        let doc: Doc = load_json(&path);
        assert_eq!(doc, Doc::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = TempDir::new("roundtrip");
        let path = dir.file("doc.json");
        let doc = Doc {
            items: vec!["a".into(), "b".into()],
        };

        save_json(&path, &doc).expect("save");
        let loaded: Doc = load_json(&path);

        assert_eq!(loaded, doc);
    }

    #[test]
    fn save_creates_missing_parent_directories() {
        let dir = TempDir::new("parents");
        let path = dir.file("nested").join("deeper").join("doc.json");

        save_json(&path, &Doc::default()).expect("save");

        assert!(path.exists());
    }

    #[test]
    fn save_replaces_previous_content_and_leaves_no_temp_file() {
        let dir = TempDir::new("atomic");
        let path = dir.file("doc.json");

        save_json(
            &path,
            &Doc {
                items: vec!["old".into()],
            },
        )
        .expect("first save");
        save_json(
            &path,
            &Doc {
                items: vec!["new".into()],
            },
        )
        .expect("second save");

        let loaded: Doc = load_json(&path);
        assert_eq!(loaded.items, vec!["new".to_string()]);
        assert!(
            leftovers(&dir.0).is_empty(),
            "temp files left behind: {:?}",
            leftovers(&dir.0)
        );
    }

    #[test]
    fn temp_sibling_is_unique_per_call() {
        let path = Path::new("/tmp/gitbaro/doc.json");
        let first = temp_sibling(path);
        let second = temp_sibling(path);

        assert_ne!(first, second);
        assert_eq!(first.parent(), path.parent());
    }
}
