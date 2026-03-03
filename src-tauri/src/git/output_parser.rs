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
