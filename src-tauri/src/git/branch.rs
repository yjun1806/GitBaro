use crate::error::AppError;
use crate::git::engine::BranchInfo;

/// Validate a branch name according to git rules.
/// Returns an error if the name is invalid.
pub fn validate_branch_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::GitCli {
            message: "Branch name cannot be empty".to_string(),
            exit_code: None,
        });
    }
    // git forbids these patterns
    let forbidden = ["..", "~", "^", ":", "?", "*", "[", "\\", " ", "\t", "\n"];
    for pat in &forbidden {
        if name.contains(pat) {
            return Err(AppError::GitCli {
                message: format!("Branch name contains invalid character: '{}'", pat),
                exit_code: None,
            });
        }
    }
    if name.starts_with('/') || name.ends_with('/') || name.ends_with('.') {
        return Err(AppError::GitCli {
            message: "Branch name cannot start/end with '/' or end with '.'".to_string(),
            exit_code: None,
        });
    }
    if name == "HEAD" {
        return Err(AppError::GitCli {
            message: "Branch name cannot be 'HEAD'".to_string(),
            exit_code: None,
        });
    }
    Ok(())
}

/// Strip the remote prefix from a remote-tracking branch name.
/// e.g. "origin/main" -> "main"
pub fn strip_remote_prefix(branch_name: &str) -> &str {
    if let Some(pos) = branch_name.find('/') {
        &branch_name[pos + 1..]
    } else {
        branch_name
    }
}

/// Find the head branch from a list of branches.
pub fn find_head(branches: &[BranchInfo]) -> Option<&BranchInfo> {
    branches.iter().find(|b| b.is_head)
}

/// Check if a branch is tracking a remote.
pub fn has_upstream(branch: &BranchInfo) -> bool {
    branch.upstream.is_some()
}

/// Format ahead/behind as a short string, e.g. "↑3 ↓1".
pub fn ahead_behind_label(ahead: usize, behind: usize) -> String {
    match (ahead, behind) {
        (0, 0) => String::new(),
        (a, 0) => format!("↑{}", a),
        (0, b) => format!("↓{}", b),
        (a, b) => format!("↑{} ↓{}", a, b),
    }
}
