//! What the repository on disk knows: which manifests declare what, and which
//! lockfiles exist.
//!
//! Manifests and lockfiles are looked for in every directory from a changed
//! file up to the repository root. That single rule makes monorepos work
//! (`packages/web/package.json` next to a root `pnpm-lock.yaml`) without ever
//! walking the tree, which matters because a full walk of a large repo is the
//! kind of stall spec §7-④ warns about.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::imports::{self, TsResolution};
use super::lockfile::{self, NameIndex, CARGO_LOCKFILE, NPM_LOCKFILES};
use super::manifest::{self, DeclaredDep, Ecosystem};

pub(super) struct ManifestFile {
    pub rel_path: String,
    pub declared: BTreeMap<String, DeclaredDep>,
}

/// Everything one ecosystem knows about this repository.
#[derive(Default)]
pub(super) struct EcosystemIndex {
    manifests: Vec<ManifestFile>,
    /// Union of every manifest's declarations.
    declared: BTreeMap<String, DeclaredDep>,
    locks: Vec<NameIndex>,
    lock_names: Vec<String>,
}

impl EcosystemIndex {
    pub fn load(repo_path: &Path, directories: &[PathBuf], ecosystem: Ecosystem) -> Self {
        let mut index = EcosystemIndex::default();
        for directory in directories {
            index.load_manifest(repo_path, directory, ecosystem);
            index.load_locks(repo_path, directory, ecosystem);
        }
        index
    }

    fn load_manifest(&mut self, repo_path: &Path, directory: &Path, ecosystem: Ecosystem) {
        let name = match ecosystem {
            Ecosystem::Npm => "package.json",
            Ecosystem::Cargo => "Cargo.toml",
        };
        let path = directory.join(name);
        let Some(content) = read_file(&path) else {
            return;
        };
        let rel_path = relative_label(repo_path, &path);

        // A `package.json` that does not parse is left out of `manifests`, which
        // is what makes the caller emit `ScanLimit{ParseFailed}` for it.
        let declared = match ecosystem {
            Ecosystem::Npm => match manifest::npm_declared(&content) {
                Some(declared) => declared,
                None => return,
            },
            Ecosystem::Cargo => manifest::cargo_declared(&content),
        };

        for (name, dep) in &declared {
            self.declared
                .entry(name.clone())
                .or_insert_with(|| dep.clone());
        }
        self.manifests.push(ManifestFile { rel_path, declared });
    }

    fn load_locks(&mut self, repo_path: &Path, directory: &Path, ecosystem: Ecosystem) {
        match ecosystem {
            Ecosystem::Npm => {
                for lock_name in NPM_LOCKFILES {
                    let path = directory.join(lock_name);
                    let Some(content) = read_file(&path) else {
                        continue;
                    };
                    if let Some(lock) = lockfile::npm_lock_index(lock_name, content) {
                        self.locks.push(lock);
                        self.lock_names.push(relative_label(repo_path, &path));
                    }
                }
            }
            Ecosystem::Cargo => {
                let path = directory.join(CARGO_LOCKFILE);
                if let Some(content) = read_file(&path) {
                    self.locks.push(lockfile::cargo_lock_index(&content));
                    self.lock_names.push(relative_label(repo_path, &path));
                }
            }
        }
    }

    pub fn manifest(&self, rel_path: &str) -> Option<&ManifestFile> {
        self.manifests.iter().find(|m| m.rel_path == rel_path)
    }

    /// The declaration for a package, tolerating Cargo's `-`/`_` equivalence.
    pub fn declared(&self, ecosystem: Ecosystem, package: &str) -> Option<DeclaredDep> {
        if let Some(dep) = self.declared.get(package) {
            return Some(dep.clone());
        }
        if ecosystem == Ecosystem::Cargo {
            let normalized = lockfile::normalize_crate(package);
            return self
                .declared
                .iter()
                .find(|(name, _)| lockfile::normalize_crate(name) == normalized)
                .map(|(_, dep)| dep.clone());
        }
        None
    }

    pub fn has_lock(&self) -> bool {
        !self.locks.is_empty()
    }

    pub fn lock_contains(&self, name: &str) -> bool {
        self.locks.iter().any(|lock| lock.contains(name))
    }

    pub fn lock_label(&self) -> String {
        if self.lock_names.is_empty() {
            "the lockfile".to_string()
        } else {
            self.lock_names.join(", ")
        }
    }
}

/// Every directory from each changed file up to the repository root.
pub(super) fn candidate_directories(repo_path: &Path, paths: &[String]) -> Vec<PathBuf> {
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();

    for path in paths {
        let mut current = Path::new(path).parent();
        while let Some(directory) = current {
            let absolute = repo_path.join(directory);
            if seen.insert(absolute.clone()) {
                out.push(absolute);
            }
            if directory.as_os_str().is_empty() {
                break;
            }
            current = directory.parent();
        }
    }

    let root = repo_path.to_path_buf();
    if seen.insert(root.clone()) {
        out.push(root);
    }
    out
}

pub(super) fn load_ts_resolution(directories: &[PathBuf]) -> TsResolution {
    let configs: Vec<(PathBuf, String)> = directories
        .iter()
        .filter_map(|directory| {
            read_file(&directory.join("tsconfig.json")).map(|content| (directory.clone(), content))
        })
        .collect();
    imports::parse_ts_resolution(&configs)
}

fn read_file(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

fn relative_label(repo_path: &Path, path: &Path) -> String {
    path.strip_prefix(repo_path)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_directories_walk_up_to_the_root_without_duplicates() {
        let repo = Path::new("/repo");
        let directories = candidate_directories(
            repo,
            &[
                "packages/web/src/a.ts".to_string(),
                "packages/web/src/b.ts".to_string(),
                "package.json".to_string(),
            ],
        );
        assert_eq!(
            directories,
            vec![
                PathBuf::from("/repo/packages/web/src"),
                PathBuf::from("/repo/packages/web"),
                PathBuf::from("/repo/packages"),
                PathBuf::from("/repo"),
            ]
        );
    }

    #[test]
    fn the_repository_root_is_always_searched() {
        let directories = candidate_directories(Path::new("/repo"), &[]);
        assert_eq!(directories, vec![PathBuf::from("/repo")]);
    }

    #[test]
    fn relative_labels_are_repo_relative() {
        assert_eq!(
            relative_label(Path::new("/repo"), Path::new("/repo/a/package.json")),
            "a/package.json"
        );
    }
}
