use crate::events::{BranchUpdate, OperationSummary};

/// Parse `git fetch` stderr output into OperationSummary.
///
/// Recognizes lines like:
///   "   abc1234..def5678  main       -> origin/main"  → updated_branches
///   " * [new branch]      feat       -> origin/feat"  → new_branches
///   " - [deleted]         old        -> origin/old"   → deleted_branches
pub fn parse_fetch_output(stderr: &str) -> Option<OperationSummary> {
    let mut updated_branches = Vec::new();
    let mut new_branches = Vec::new();
    let mut deleted_branches = Vec::new();

    for line in stderr.lines() {
        let trimmed = line.trim();
        if trimmed.contains("[new branch]") || trimmed.contains("[new tag]") {
            if let Some(arrow_pos) = trimmed.find("->") {
                let name = trimmed[arrow_pos + 2..].trim().to_string();
                new_branches.push(name);
            }
        } else if trimmed.starts_with("- [deleted]") {
            if let Some(arrow_pos) = trimmed.find("->") {
                let name = trimmed[arrow_pos + 2..].trim().to_string();
                deleted_branches.push(name);
            }
        } else if trimmed.contains("..") && trimmed.contains("->") {
            let parts: Vec<&str> = trimmed.splitn(2, char::is_whitespace).collect();
            if let Some(oids) = parts.first() {
                let oid_parts: Vec<&str> = oids.split("..").collect();
                if oid_parts.len() == 2 {
                    if let Some(arrow_pos) = trimmed.find("->") {
                        let name = trimmed[arrow_pos + 2..].trim().to_string();
                        updated_branches.push(BranchUpdate {
                            name,
                            old_oid: oid_parts[0].to_string(),
                            new_oid: oid_parts[1].to_string(),
                        });
                    }
                }
            }
        }
    }

    if updated_branches.is_empty() && new_branches.is_empty() && deleted_branches.is_empty() {
        return None;
    }

    Some(OperationSummary::Fetch {
        updated_branches,
        new_branches,
        deleted_branches,
    })
}

/// Parse `git push` stderr output into OperationSummary.
pub fn parse_push_output(stderr: &str, branch: &str, remote: &str) -> Option<OperationSummary> {
    let commit_count = stderr
        .lines()
        .filter(|l| l.contains("..") && l.contains("->"))
        .count() as u32;

    Some(OperationSummary::Push {
        branch: branch.to_string(),
        commit_count: commit_count.max(1),
        remote: remote.to_string(),
    })
}

/// Parse `git push --porcelain --dry-run` stdout to find local tags that would
/// be newly created on the remote. Mirrors GitHub Desktop's `fetchTagsToPush`.
///
/// Porcelain status lines are tab-separated: `<flag>\t<from>:<to>\t<summary>`.
/// A new tag appears as: `*\trefs/tags/v1.0:refs/tags/v1.0\t[new tag]`.
/// The first line (`To <url>`) is skipped and parsing stops at `Done`.
pub fn parse_tags_to_push(stdout: &str) -> Vec<String> {
    let mut tags = Vec::new();

    for line in stdout.lines().skip(1) {
        if line.contains("Done") {
            break;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 && parts[0] == "*" && parts[2] == "[new tag]" {
            let tag = parts[1]
                .split(':')
                .next()
                .unwrap_or("")
                .trim_start_matches("refs/tags/");
            if !tag.is_empty() {
                tags.push(tag.to_string());
            }
        }
    }

    tags
}

/// Parse `git ls-remote --tags <remote>` stdout into a de-duplicated list of
/// remote tag names.
///
/// Each line is `<sha>\trefs/tags/<name>`. Annotated tags also emit a peeled
/// line `<sha>\trefs/tags/<name>^{}`; both map to the same name after stripping
/// the `refs/tags/` prefix and the `^{}` suffix.
pub fn parse_remote_tags(stdout: &str) -> Vec<String> {
    let mut tags = Vec::new();

    for line in stdout.lines() {
        let Some((_, refname)) = line.split_once('\t') else {
            continue;
        };
        let Some(name) = refname.strip_prefix("refs/tags/") else {
            continue;
        };
        let name = name.strip_suffix("^{}").unwrap_or(name);
        if !name.is_empty() && !tags.iter().any(|t| t == name) {
            tags.push(name.to_string());
        }
    }

    tags
}

/// Parse `git merge` stdout output into OperationSummary.
pub fn parse_merge_output(stdout: &str, source_branch: &str) -> Option<OperationSummary> {
    let has_conflicts =
        stdout.contains("CONFLICT") || stdout.contains("Automatic merge failed");
    let merge_type = if stdout.contains("Fast-forward") {
        "fast-forward"
    } else if stdout.contains("squash") {
        "squash"
    } else {
        "merge"
    };

    let files_changed = stdout
        .lines()
        .find(|l| l.contains("file") && l.contains("changed"))
        .and_then(|l| l.split_whitespace().next())
        .and_then(|n| n.parse::<u32>().ok())
        .unwrap_or(0);

    Some(OperationSummary::Merge {
        merge_type: merge_type.to_string(),
        files_changed,
        has_conflicts,
        source_branch: source_branch.to_string(),
    })
}

/// Parse `git pull` stdout/stderr output into OperationSummary.
pub fn parse_pull_output(stdout: &str, stderr: &str) -> Option<OperationSummary> {
    let has_conflicts =
        stdout.contains("CONFLICT") || stdout.contains("Automatic merge failed");
    let merge_type = if stdout.contains("Fast-forward") {
        "fast-forward"
    } else if stderr.contains("rebase") || stdout.contains("rebase") {
        "rebase"
    } else {
        "merge"
    };

    let files_changed = stdout
        .lines()
        .find(|l| l.contains("file") && l.contains("changed"))
        .and_then(|l| l.split_whitespace().next())
        .and_then(|n| n.parse::<u32>().ok())
        .unwrap_or(0);

    Some(OperationSummary::Pull {
        merge_type: merge_type.to_string(),
        files_changed,
        has_conflicts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_new_tags_from_porcelain_dry_run() {
        // `git push origin main --follow-tags --dry-run --porcelain` output.
        let stdout = "To github.com:owner/repo.git\n\
            =\trefs/heads/main:refs/heads/main\tup to date\n\
            *\trefs/tags/v1.0.0:refs/tags/v1.0.0\t[new tag]\n\
            *\trefs/tags/v1.1.0:refs/tags/v1.1.0\t[new tag]\n\
            Done";
        assert_eq!(parse_tags_to_push(stdout), vec!["v1.0.0", "v1.1.0"]);
    }

    #[test]
    fn ignores_non_tag_ref_updates() {
        // A branch update alongside no new tags yields no tags.
        let stdout = "To github.com:owner/repo.git\n\
            \trefs/heads/main:refs/heads/main\t0000000..abc1234\n\
            Done";
        assert!(parse_tags_to_push(stdout).is_empty());
    }

    #[test]
    fn returns_empty_for_no_output() {
        assert!(parse_tags_to_push("").is_empty());
    }

    #[test]
    fn dedupes_peeled_annotated_tags_from_ls_remote() {
        // Annotated tag v1.0.0 emits both a ref line and a peeled `^{}` line.
        let stdout = "abc123\trefs/tags/v1.0.0\n\
            def456\trefs/tags/v1.0.0^{}\n\
            789abc\trefs/tags/v2.0.0\n";
        assert_eq!(parse_remote_tags(stdout), vec!["v1.0.0", "v2.0.0"]);
    }

    #[test]
    fn ignores_non_tag_lines_in_ls_remote() {
        let stdout = "abc123\tHEAD\n\
            def456\trefs/heads/main\n";
        assert!(parse_remote_tags(stdout).is_empty());
    }
}
