use std::cell::RefCell;
use std::path::Path;

use git2::{BranchType, MergeOptions, Repository, StashFlags, build::CheckoutBuilder};

use crate::error::AppError;
use crate::git::branch::validate_branch_name;
use crate::git::commit::{build_ref_map, commit_to_info, signature_to_author, validate_message};
use crate::git::diff::convert_diff;
use crate::git::engine::{
    BlameLine, BranchInfo, CommitInfo, ConflictFile, DiffOutput, DiffSpec, FileStatus,
    GitEngine, LogOptions, MergeResult, StashEntry, StashFileSummary, StashShowResult, StatusEntry,
};

/// git2 `Repository` requires `&mut self` for stash/merge operations.
/// We wrap it in `RefCell` so the `GitEngine` trait (which uses `&self`) can
/// borrow mutably when needed without changing the trait signature.
pub struct LibGitEngine {
    pub repo: RefCell<Repository>,
}

impl LibGitEngine {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        let repo = Repository::open(path)?;
        Ok(Self {
            repo: RefCell::new(repo),
        })
    }

    #[allow(dead_code)]
    fn head_commit_oid(&self) -> Result<Option<git2::Oid>, AppError> {
        let repo = self.repo.borrow();
        let result = match repo.head() {
            Ok(head) => Ok(Some(head.peel_to_commit()?.id())),
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => Ok(None),
            Err(e) => Err(e.into()),
        };
        result
    }
}

impl GitEngine for LibGitEngine {
    fn status(&self) -> Result<Vec<StatusEntry>, AppError> {
        let repo = self.repo.borrow();
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false);

        let statuses = repo.statuses(Some(&mut opts))?;
        let mut entries = Vec::new();

        for entry in statuses.iter() {
            let path = entry.path().unwrap_or("").to_string();
            let flags = entry.status();

            let status = if flags.contains(git2::Status::CONFLICTED) {
                FileStatus::Conflicted
            } else if flags.contains(git2::Status::INDEX_NEW) {
                FileStatus::IndexAdded
            } else if flags.contains(git2::Status::INDEX_MODIFIED) {
                FileStatus::IndexModified
            } else if flags.contains(git2::Status::INDEX_DELETED) {
                FileStatus::IndexDeleted
            } else if flags.contains(git2::Status::INDEX_RENAMED) {
                FileStatus::IndexRenamed
            } else if flags.contains(git2::Status::WT_NEW) {
                FileStatus::Untracked
            } else if flags.contains(git2::Status::WT_MODIFIED) {
                FileStatus::Modified
            } else if flags.contains(git2::Status::WT_DELETED) {
                FileStatus::Deleted
            } else if flags.contains(git2::Status::WT_RENAMED) {
                FileStatus::Renamed
            } else if flags.contains(git2::Status::IGNORED) {
                FileStatus::Ignored
            } else {
                FileStatus::Modified
            };

            let original_path = entry
                .head_to_index()
                .and_then(|d| d.old_file().path())
                .map(|p| p.to_string_lossy().into_owned());

            entries.push(StatusEntry {
                path,
                status,
                original_path,
            });
        }

        Ok(entries)
    }

    fn diff(&self, spec: &DiffSpec) -> Result<DiffOutput, AppError> {
        let repo = self.repo.borrow();

        let diff = if spec.staged {
            let head_tree = repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_tree().ok());
            repo.diff_tree_to_index(head_tree.as_ref(), None, None)?
        } else if let (Some(old_rev), Some(new_rev)) = (&spec.old_rev, &spec.new_rev) {
            let old_obj = repo.revparse_single(old_rev)?;
            let new_obj = repo.revparse_single(new_rev)?;
            let old_tree = old_obj.peel_to_tree()?;
            let new_tree = new_obj.peel_to_tree()?;
            repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), None)?
        } else {
            repo.diff_index_to_workdir(None, None)?
        };

        convert_diff(&diff)
    }

    fn commit(&self, message: &str, amend: bool) -> Result<String, AppError> {
        validate_message(message)?;

        let repo = self.repo.borrow();
        let sig = repo.signature()?;
        let mut index = repo.index()?;
        index.write()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;

        let commit_id = if amend {
            let head = repo.head()?;
            let head_commit = head.peel_to_commit()?;
            head_commit.amend(
                Some("HEAD"),
                Some(&sig),
                Some(&sig),
                None,
                Some(message),
                Some(&tree),
            )?
        } else {
            let parent_commits: Vec<git2::Commit<'_>> = match repo.head() {
                Ok(head) => vec![head.peel_to_commit()?],
                Err(_) => vec![],
            };
            let parent_refs: Vec<&git2::Commit<'_>> = parent_commits.iter().collect();
            repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)?
        };

        Ok(commit_id.to_string())
    }

    fn log(&self, opts: &LogOptions) -> Result<Vec<CommitInfo>, AppError> {
        let repo = self.repo.borrow();
        let ref_map = build_ref_map(&repo);
        let mut revwalk = repo.revwalk()?;

        if let Some(branch_name) = &opts.branch {
            let branch = repo
                .find_branch(branch_name, BranchType::Local)
                .or_else(|_| repo.find_branch(branch_name, BranchType::Remote))?;
            let oid = branch.get().peel_to_commit()?.id();
            revwalk.push(oid)?;
        } else {
            revwalk.push_head().unwrap_or(());
        }

        revwalk.set_sorting(git2::Sort::TIME)?;

        let limit = opts.limit.unwrap_or(100);
        let offset = opts.offset.unwrap_or(0);
        let mut commits = Vec::new();

        for (idx, oid_result) in revwalk.enumerate() {
            let oid = oid_result?;
            if idx < offset {
                continue;
            }
            if commits.len() >= limit {
                break;
            }
            let commit = repo.find_commit(oid)?;
            let mut info = commit_to_info(&commit);
            if let Some(labels) = ref_map.get(&oid) {
                info.refs = labels.clone();
            }
            commits.push(info);
        }

        Ok(commits)
    }

    fn branches(&self) -> Result<Vec<BranchInfo>, AppError> {
        let repo = self.repo.borrow();

        let _head_oid = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .map(|c| c.id());

        let mut infos = Vec::new();

        for branch_result in repo.branches(None)? {
            let (branch, branch_type) = branch_result?;
            let name = branch.name()?.unwrap_or("").to_string();
            let is_remote = branch_type == BranchType::Remote;

            // origin/HEAD 같은 심볼릭 참조는 실제 브랜치가 아니므로 제외
            if is_remote && name.ends_with("/HEAD") {
                continue;
            }

            let commit = branch.get().peel_to_commit()?;
            let commit_oid = commit.id();
            let commit_id = commit_oid.to_string();
            let is_head = branch.is_head();

            let upstream_name = branch
                .upstream()
                .ok()
                .and_then(|u| u.name().ok().flatten().map(String::from));

            let (ahead, behind) = if let Some(ref up_name) = upstream_name {
                repo.find_branch(up_name, BranchType::Remote)
                    .ok()
                    .and_then(|up| up.get().peel_to_commit().ok())
                    .and_then(|up_commit| {
                        repo.graph_ahead_behind(commit_oid, up_commit.id()).ok()
                    })
                    .unwrap_or((0, 0))
            } else {
                (0, 0)
            };

            infos.push(BranchInfo {
                name,
                is_remote,
                is_head,
                upstream: upstream_name,
                ahead,
                behind,
                commit_id,
            });
        }

        Ok(infos)
    }

    fn create_branch(&self, name: &str, from: Option<&str>) -> Result<(), AppError> {
        validate_branch_name(name)?;
        let repo = self.repo.borrow();

        let target_commit = if let Some(rev) = from {
            let obj = repo.revparse_single(rev)?;
            obj.peel_to_commit()?
        } else {
            repo.head()?.peel_to_commit()?
        };

        repo.branch(name, &target_commit, false)?;
        Ok(())
    }

    fn switch_branch(&self, name: &str) -> Result<(), AppError> {
        let repo = self.repo.borrow();
        let (obj, reference) = repo.revparse_ext(name)?;
        repo.checkout_tree(&obj, None)?;

        match reference {
            Some(gref) => {
                let ref_name = gref.name().ok_or_else(|| AppError::GitCli {
                    message: "Invalid ref name".to_string(),
                    exit_code: None,
                })?;
                repo.set_head(ref_name)?;
            }
            None => {
                repo.set_head_detached(obj.id())?;
            }
        }
        Ok(())
    }

    fn delete_branch(&self, name: &str, _force: bool) -> Result<(), AppError> {
        let repo = self.repo.borrow();
        let mut branch = repo.find_branch(name, BranchType::Local)?;
        branch.delete()?;
        Ok(())
    }

    fn current_branch(&self) -> Result<Option<String>, AppError> {
        let repo = self.repo.borrow();
        let result = match repo.head() {
            Ok(head) => {
                if head.is_branch() {
                    Ok(head.shorthand().map(String::from))
                } else {
                    Ok(None)
                }
            }
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => Ok(None),
            Err(e) => Err(e.into()),
        };
        result
    }

    fn stage_files(&self, paths: &[String]) -> Result<(), AppError> {
        let repo = self.repo.borrow();
        let mut index = repo.index()?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| AppError::GitCli {
                message: "Repository has no working directory (bare repo)".to_string(),
                exit_code: None,
            })?
            .to_path_buf();

        for path_str in paths {
            let path = std::path::Path::new(path_str);
            let full = workdir.join(path);
            if full.exists() {
                if full.is_dir() {
                    index.add_all(
                        [format!("{}/*", path_str)],
                        git2::IndexAddOption::DEFAULT,
                        None,
                    )?;
                } else {
                    index.add_path(path)?;
                }
            } else {
                index.remove_path(path)?;
            }
        }

        index.write()?;
        Ok(())
    }

    fn unstage_files(&self, paths: &[String]) -> Result<(), AppError> {
        let repo = self.repo.borrow();
        match repo.head().ok().and_then(|h| h.peel_to_commit().ok()) {
            Some(head_commit) => {
                repo.reset_default(
                    Some(head_commit.as_object()),
                    paths.iter().map(|s| s.as_str()),
                )?;
            }
            None => {
                let mut index = repo.index()?;
                for p in paths {
                    index.remove_path(std::path::Path::new(p))?;
                }
                index.write()?;
            }
        }
        Ok(())
    }

    fn discard_changes(&self, paths: &[String]) -> Result<(), AppError> {
        let repo = self.repo.borrow();
        let mut checkout = CheckoutBuilder::new();
        checkout.force();
        for p in paths {
            checkout.path(p);
        }
        repo.checkout_index(None, Some(&mut checkout))?;
        Ok(())
    }

    fn stash_save(&self, message: Option<&str>) -> Result<(), AppError> {
        let mut repo = self.repo.borrow_mut();
        let sig = repo.signature()?;
        let msg = message.unwrap_or("WIP");
        repo.stash_save(&sig, msg, Some(StashFlags::DEFAULT))?;
        Ok(())
    }

    fn stash_pop(&self) -> Result<(), AppError> {
        let mut repo = self.repo.borrow_mut();
        repo.stash_pop(0, None)?;
        Ok(())
    }

    fn stash_list(&self) -> Result<Vec<StashEntry>, AppError> {
        // Pass 1: collect raw entries via stash_foreach (requires &mut repo)
        let mut raw: Vec<(usize, String, git2::Oid)> = Vec::new();
        {
            let mut repo = self.repo.borrow_mut();
            repo.stash_foreach(|index, message, oid| {
                raw.push((index, message.to_string(), *oid));
                true
            })?;
        }

        // Pass 2: enrich with timestamp + branch_name (immutable borrow is fine)
        let repo = self.repo.borrow();
        let entries = raw
            .into_iter()
            .map(|(index, message, oid)| {
                let timestamp = repo
                    .find_commit(oid)
                    .map(|c| c.time().seconds())
                    .unwrap_or(0);
                let branch_name =
                    crate::git::stash::extract_branch_from_stash_message(&message);
                StashEntry {
                    index,
                    message,
                    commit_id: oid.to_string(),
                    branch_name,
                    timestamp,
                }
            })
            .collect();
        Ok(entries)
    }

    fn merge_branch(&self, branch: &str) -> Result<MergeResult, AppError> {
        // Find the annotated commit for the target branch
        let (annotated_oid, analysis) = {
            let repo = self.repo.borrow();
            let branch_ref = repo.find_branch(branch, BranchType::Local)?;
            let oid = branch_ref.get().peel_to_commit()?.id();
            let annotated = repo.find_annotated_commit(oid)?;
            let analysis = repo.merge_analysis(&[&annotated])?;
            (oid, analysis.0)
        };

        if analysis.is_up_to_date() {
            return Ok(MergeResult::AlreadyUpToDate);
        }

        if analysis.is_fast_forward() {
            let repo = self.repo.borrow();
            let target_commit = repo.find_commit(annotated_oid)?;
            let mut checkout = CheckoutBuilder::new();
            checkout.safe();
            repo.checkout_tree(target_commit.as_object(), Some(&mut checkout))?;
            let head_ref_name = repo
                .head()?
                .name()
                .ok_or_else(|| AppError::GitCli {
                    message: "HEAD has no name".to_string(),
                    exit_code: None,
                })?
                .to_string();
            repo.find_reference(&head_ref_name)?.set_target(
                annotated_oid,
                &format!("Fast-forward merge to {}", branch),
            )?;
            return Ok(MergeResult::FastForward {
                commit_id: annotated_oid.to_string(),
            });
        }

        // Normal three-way merge — requires &mut repo
        {
            let repo = self.repo.borrow_mut();
            let annotated = repo.find_annotated_commit(annotated_oid)?;
            repo.merge(&[&annotated], Some(&mut MergeOptions::new()), None)?;
        }

        // Check for conflicts
        {
            let repo = self.repo.borrow();
            let index = repo.index()?;
            if index.has_conflicts() {
                let mut conflict_files = Vec::new();
                for conflict in index.conflicts()? {
                    let conflict = conflict?;
                    let path = conflict
                        .our
                        .as_ref()
                        .or(conflict.their.as_ref())
                        .or(conflict.ancestor.as_ref())
                        .and_then(|e| std::str::from_utf8(&e.path).ok().map(String::from))
                        .unwrap_or_default();
                    conflict_files.push(ConflictFile {
                        path,
                        ours: None,
                        theirs: None,
                        base: None,
                    });
                }
                return Ok(MergeResult::Conflict(conflict_files));
            }
        }

        // Finalize merge commit
        let commit_id = {
            let repo = self.repo.borrow();
            let sig = repo.signature()?;
            let mut index = repo.index()?;
            let tree_oid = index.write_tree()?;
            let tree = repo.find_tree(tree_oid)?;
            let head_commit = repo
                .head()?
                .peel_to_commit()
                .map_err(|_| AppError::GitCli {
                    message: "No HEAD commit for merge".to_string(),
                    exit_code: None,
                })?;
            let merge_commit = repo.find_commit(annotated_oid)?;
            let msg = format!("Merge branch '{}'", branch);
            repo.commit(
                Some("HEAD"),
                &sig,
                &sig,
                &msg,
                &tree,
                &[&head_commit, &merge_commit],
            )?
        };

        // Clean up merge state — requires &mut repo
        self.repo.borrow_mut().cleanup_state()?;

        Ok(MergeResult::Clean {
            commit_id: commit_id.to_string(),
        })
    }

    fn blame(&self, path: &str) -> Result<Vec<BlameLine>, AppError> {
        let repo = self.repo.borrow();
        let blame = repo.blame_file(std::path::Path::new(path), None)?;
        let workdir = repo.workdir().ok_or_else(|| AppError::GitCli {
            message: "Bare repository has no working directory".to_string(),
            exit_code: None,
        })?;
        let content = std::fs::read_to_string(workdir.join(path))?;
        let lines: Vec<&str> = content.lines().collect();
        let mut result = Vec::new();

        for (i, line_content) in lines.iter().enumerate() {
            let line_no = i + 1;
            let hunk = blame.get_line(line_no).ok_or_else(|| AppError::GitCli {
                message: format!("No blame hunk for line {}", line_no),
                exit_code: None,
            })?;
            let commit_oid = hunk.final_commit_id();
            let commit = repo.find_commit(commit_oid)?;
            let author = signature_to_author(&commit.author());
            let summary = commit.summary().unwrap_or("").to_string();
            result.push(BlameLine {
                line_no: line_no as u32,
                content: line_content.to_string(),
                commit_id: commit_oid.to_string(),
                author,
                summary,
            });
        }

        Ok(result)
    }
}

// ── LibGitEngine extra methods (not in trait) ────────────────────────────────

impl LibGitEngine {
    /// Show the file summary for a stash entry.
    /// Not part of the GitEngine trait — only LibGitEngine exposes this directly.
    pub fn stash_show(&self, index: usize) -> Result<StashShowResult, AppError> {
        let repo = self.repo.borrow();
        let stash_ref = crate::git::stash::stash_ref(index);
        let obj = repo.revparse_single(&stash_ref)?;
        let stash_commit = obj.peel_to_commit()?;
        let stash_tree = stash_commit.tree()?;
        let parent = stash_commit.parent(0)?;
        let parent_tree = parent.tree()?;
        let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&stash_tree), None)?;

        let mut files = Vec::new();
        for idx in 0..diff.deltas().count() {
            let delta = diff.get_delta(idx).unwrap();
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let status = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Modified => "modified",
                git2::Delta::Renamed => "renamed",
                _ => "modified",
            };

            let (insertions, deletions) = match git2::Patch::from_diff(&diff, idx) {
                Ok(Some(patch)) => {
                    let (_, ins, del) = patch.line_stats().unwrap_or((0, 0, 0));
                    (ins, del)
                }
                _ => (0, 0),
            };

            files.push(StashFileSummary {
                path,
                status: status.to_string(),
                insertions,
                deletions,
            });
        }

        let message = stash_commit.message().unwrap_or("").to_string();
        let timestamp = stash_commit.time().seconds();
        let branch_name = crate::git::stash::extract_branch_from_stash_message(&message);
        let entry = StashEntry {
            index,
            message,
            commit_id: stash_commit.id().to_string(),
            branch_name,
            timestamp,
        };

        Ok(StashShowResult { entry, files })
    }
}
