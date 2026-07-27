// SPDX-License-Identifier: GPL-3.0-or-later
//! The on-disk snapshot of the symbol index (design §3.2 · §3.4).
//!
//! **Disk is a cache; memory is the authority.** A missing, corrupt or
//! stale-schema snapshot has exactly one consequence — a full rebuild — and no
//! other behavioural difference. Nothing here may ever fail a scan.
//!
//! Records are sharded 64 ways by path hash so that editing five files rewrites
//! at most five shards instead of the whole index. Every write goes through a
//! `.tmp` file and a rename, so a crash mid-write leaves the previous snapshot
//! intact rather than a truncated one.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

use super::index::RepoIndex;
use super::model::FileSymbols;
use super::tokens::fnv1a32;

/// Bump when the record shape changes.
const SCHEMA_VERSION: u32 = 1;
/// Bump when extraction rules change without the record shape changing —
/// otherwise an improved extractor keeps reading its own old output.
const EXTRACTOR_VERSION: u32 = 1;
const SHARD_COUNT: u32 = 64;
const META_FILE: &str = "meta.json";
const SHARD_DIR: &str = "shards";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct CacheMeta {
    schema_version: u32,
    extractor_version: u32,
    tool_version: String,
    files_total: usize,
    file_count: usize,
    symbol_count: usize,
    built_at: Option<i64>,
    complete: bool,
    skipped_by_language: BTreeMap<String, usize>,
    skipped_by_budget: usize,
    parse_failed: usize,
}

#[derive(Serialize, Deserialize, Default)]
struct Shard {
    files: Vec<FileSymbols>,
}

fn shard_of(path: &str) -> u32 {
    fnv1a32(path.as_bytes()) % SHARD_COUNT
}

fn shard_path(dir: &Path, shard: u32) -> PathBuf {
    dir.join(SHARD_DIR).join(format!("{shard:02x}.json"))
}

/// Load a snapshot, or `None` when there is nothing usable. A schema mismatch
/// deletes the directory so the next save starts from a clean slate.
pub fn load(dir: &Path) -> Option<RepoIndex> {
    let raw = std::fs::read_to_string(dir.join(META_FILE)).ok()?;
    let meta: CacheMeta = match serde_json::from_str(&raw) {
        Ok(meta) => meta,
        Err(e) => {
            tracing::warn!("[verify] symbol index meta unreadable: {} — rebuilding", e);
            clear(dir);
            return None;
        }
    };

    if meta.schema_version != SCHEMA_VERSION
        || meta.extractor_version != EXTRACTOR_VERSION
        || meta.tool_version != env!("CARGO_PKG_VERSION")
    {
        tracing::debug!("[verify] symbol index schema changed — rebuilding");
        clear(dir);
        return None;
    }

    let mut index = RepoIndex {
        complete: meta.complete,
        files_total: meta.files_total,
        built_at: meta.built_at,
        skipped_by_language: meta.skipped_by_language,
        skipped_by_budget: meta.skipped_by_budget,
        ..RepoIndex::default()
    };

    for shard in 0..SHARD_COUNT {
        let Ok(raw) = std::fs::read_to_string(shard_path(dir, shard)) else {
            continue;
        };
        match serde_json::from_str::<Shard>(&raw) {
            Ok(shard) => {
                for file in shard.files {
                    index.insert(file);
                }
            }
            Err(e) => {
                tracing::warn!("[verify] symbol index shard unreadable: {} — rebuilding", e);
                clear(dir);
                return None;
            }
        }
    }

    Some(index)
}

/// Write the snapshot. `dirty` restricts the rewrite to the shards holding
/// those paths; `None` rewrites everything.
pub fn save(
    dir: &Path,
    index: &RepoIndex,
    dirty: Option<&BTreeSet<String>>,
) -> Result<(), AppError> {
    std::fs::create_dir_all(dir.join(SHARD_DIR))?;

    let targets: BTreeSet<u32> = match dirty {
        Some(paths) if !paths.is_empty() => paths.iter().map(|path| shard_of(path)).collect(),
        Some(_) => BTreeSet::new(),
        None => (0..SHARD_COUNT).collect(),
    };

    let mut grouped: BTreeMap<u32, Shard> = BTreeMap::new();
    for shard in &targets {
        grouped.insert(*shard, Shard::default());
    }
    for file in index.files() {
        let shard = shard_of(&file.path);
        if let Some(bucket) = grouped.get_mut(&shard) {
            bucket.files.push(file.clone());
        }
    }
    for (shard, bucket) in grouped {
        write_atomic(&shard_path(dir, shard), &serde_json::to_vec(&bucket)?)?;
    }

    let meta = CacheMeta {
        schema_version: SCHEMA_VERSION,
        extractor_version: EXTRACTOR_VERSION,
        tool_version: env!("CARGO_PKG_VERSION").to_string(),
        files_total: index.files_total,
        file_count: index.file_count(),
        symbol_count: index.symbol_count(),
        built_at: index.built_at,
        complete: index.complete,
        skipped_by_language: index.skipped_by_language.clone(),
        skipped_by_budget: index.skipped_by_budget,
        parse_failed: index.parse_failed,
    };
    write_atomic(&dir.join(META_FILE), &serde_json::to_vec_pretty(&meta)?)?;
    Ok(())
}

pub fn clear(dir: &Path) {
    if let Err(e) = std::fs::remove_dir_all(dir) {
        if e.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!("[verify] could not clear {:?}: {}", dir, e);
        }
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::context::index::fixture::index_from_sources;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "gitbaro-ctxcache-{}-{}-{}",
                tag,
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).expect("create temp dir");
            TempDir(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn sample() -> RepoIndex {
        index_from_sources(&[
            ("src/a.ts", "export function alpha() { return 1; }"),
            ("src/b.rs", "pub fn beta() -> u32 { 2 }"),
        ])
    }

    #[test]
    fn a_snapshot_round_trips() {
        let dir = TempDir::new("roundtrip");
        let index = sample();
        save(&dir.0, &index, None).expect("save");

        let loaded = load(&dir.0).expect("load");
        assert_eq!(loaded.file_count(), index.file_count());
        assert_eq!(loaded.symbol_count(), index.symbol_count());
        assert!(loaded.complete);
        assert!(loaded.file("src/a.ts").is_some());
        assert_eq!(
            loaded.file("src/b.rs").expect("b").symbols[0].name,
            "beta"
        );
    }

    #[test]
    fn an_absent_snapshot_loads_as_none() {
        let dir = TempDir::new("absent");
        assert!(load(&dir.0).is_none());
    }

    #[test]
    fn a_schema_mismatch_discards_the_snapshot() {
        let dir = TempDir::new("schema");
        save(&dir.0, &sample(), None).expect("save");

        let meta_path = dir.0.join(META_FILE);
        let raw = std::fs::read_to_string(&meta_path).expect("read meta");
        let bumped = raw.replace(
            &format!("\"schemaVersion\": {SCHEMA_VERSION}"),
            "\"schemaVersion\": 999",
        );
        assert_ne!(raw, bumped, "the meta key must be present to rewrite");
        std::fs::write(&meta_path, bumped).expect("write meta");

        assert!(load(&dir.0).is_none());
        assert!(!meta_path.exists(), "a stale cache is deleted, not kept");
    }

    #[test]
    fn a_corrupt_shard_discards_the_snapshot_instead_of_failing() {
        let dir = TempDir::new("corrupt");
        let index = sample();
        save(&dir.0, &index, None).expect("save");
        let shard = shard_of("src/a.ts");
        std::fs::write(shard_path(&dir.0, shard), "{ not json").expect("corrupt");

        assert!(load(&dir.0).is_none());
    }

    #[test]
    fn only_dirty_shards_are_rewritten() {
        let dir = TempDir::new("dirty");
        let index = sample();
        save(&dir.0, &index, None).expect("initial save");

        let untouched = shard_path(&dir.0, shard_of("src/b.rs"));
        let before = std::fs::metadata(&untouched).expect("meta").len();
        std::fs::write(&untouched, std::fs::read(&untouched).expect("read")).expect("rewrite");

        let dirty: BTreeSet<String> = ["src/a.ts".to_string()].into_iter().collect();
        save(&dir.0, &index, Some(&dirty)).expect("incremental save");

        // The untouched shard still holds `beta`, and a reload sees both files.
        assert_eq!(
            std::fs::metadata(&untouched).expect("meta").len(),
            before,
            "an untouched shard must not be rewritten"
        );
        assert_eq!(load(&dir.0).expect("load").file_count(), 2);
    }

    #[test]
    fn a_deleted_file_disappears_from_its_shard() {
        let dir = TempDir::new("delete");
        save(&dir.0, &sample(), None).expect("save");

        let smaller = index_from_sources(&[("src/b.rs", "pub fn beta() -> u32 { 2 }")]);
        let dirty: BTreeSet<String> = ["src/a.ts".to_string()].into_iter().collect();
        save(&dir.0, &smaller, Some(&dirty)).expect("save");

        let loaded = load(&dir.0).expect("load");
        assert!(loaded.file("src/a.ts").is_none());
        assert!(loaded.file("src/b.rs").is_some());
    }
}
