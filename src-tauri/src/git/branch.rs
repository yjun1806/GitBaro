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
    // A leading '-' would be parsed as a CLI flag (option injection) and is not a
    // valid git ref anyway.
    if name.starts_with('-') {
        return Err(AppError::GitCli {
            message: "Branch name cannot start with '-'".to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_branch_names() {
        assert!(validate_branch_name("main").is_ok());
        assert!(validate_branch_name("feature/foo-bar").is_ok());
        assert!(validate_branch_name("release-1.2").is_ok());
    }

    #[test]
    fn rejects_leading_dash_option_injection() {
        // A leading '-' would be parsed as a git CLI flag.
        assert!(validate_branch_name("-f").is_err());
        assert!(validate_branch_name("--force").is_err());
        assert!(validate_branch_name("-D").is_err());
    }

    #[test]
    fn rejects_git_forbidden_patterns() {
        assert!(validate_branch_name("").is_err());
        assert!(validate_branch_name("foo..bar").is_err());
        assert!(validate_branch_name("foo bar").is_err());
        assert!(validate_branch_name("foo~1").is_err());
        assert!(validate_branch_name("HEAD").is_err());
        assert!(validate_branch_name("/foo").is_err());
        assert!(validate_branch_name("foo.").is_err());
    }

    #[test]
    fn strips_remote_prefix() {
        assert_eq!(strip_remote_prefix("origin/main"), "main");
        assert_eq!(strip_remote_prefix("main"), "main");
    }
}
