use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),

    #[error("Git CLI failed (exit {exit_code:?}): {message}")]
    GitCli {
        message: String,
        exit_code: Option<i32>,
    },

    /// merge·rebase·pull 등이 충돌로 멈췄다. 작업 트리에 충돌 파일이 남아 있다.
    #[error("Merge conflict: {0}")]
    MergeConflict(String),

    #[error("Authentication error: {0}")]
    Auth(String),

    /// The account's GitHub sign-in cannot be used: gh has no token for it, or
    /// GitHub/git rejected the token even after re-reading it from gh.
    #[error("GitHub sign-in for {account_id} is missing or expired. Sign in again in Settings > Accounts.")]
    TokenExpired { account_id: String },

    #[error("GitHub API error ({status}): {message}")]
    GithubApi { status: u16, message: String },

    #[error("GitHub rate limit exceeded, resets at {reset_at}")]
    RateLimit { reset_at: String },

    #[error("Network error: {0}")]
    Network(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Git CLI not found. Install Xcode Command Line Tools.")]
    GitCliNotFound,

    #[error("GitHub CLI (gh) not found. Install with: brew install gh")]
    GhCliNotFound,

    #[error("GitHub CLI error: {0}")]
    GhCli(String),

    #[error("GitHub CLI version too old: {0}")]
    GhVersionTooOld(String),

    #[error("Channel error: {0}")]
    Channel(String),

    #[error("Repository not found: {0}")]
    RepoNotFound(String),

    #[error("Bare repositories are not supported: {0}")]
    BareRepository(String),
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Network(e.to_string())
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;

        let (error_type, message) = match self {
            AppError::Git(e) => ("Git", e.to_string()),
            AppError::GitCli { message, .. } => ("GitCli", message.clone()),
            AppError::MergeConflict(msg) => ("MergeConflict", msg.clone()),
            AppError::Auth(msg) => ("Auth", msg.clone()),
            AppError::TokenExpired { .. } => ("TokenExpired", self.to_string()),
            AppError::GithubApi { status, message } => {
                ("GithubApi", format!("HTTP {}: {}", status, message))
            }
            AppError::RateLimit { reset_at } => {
                ("RateLimit", format!("Resets at {}", reset_at))
            }
            AppError::Network(msg) => ("Network", msg.clone()),
            AppError::Io(e) => ("Io", e.to_string()),
            AppError::Serde(e) => ("Serde", e.to_string()),
            AppError::GitCliNotFound => ("GitCliNotFound", self.to_string()),
            AppError::GhCliNotFound => ("GhCliNotFound", self.to_string()),
            AppError::GhCli(msg) => ("GhCli", msg.clone()),
            AppError::GhVersionTooOld(msg) => ("GhVersionTooOld", msg.clone()),
            AppError::Channel(msg) => ("Channel", msg.clone()),
            AppError::RepoNotFound(path) => ("RepoNotFound", path.clone()),
            AppError::BareRepository(_) => ("BareRepository", self.to_string()),
        };

        // The frontend names the account and offers to sign in again.
        let account_id = match self {
            AppError::TokenExpired { account_id } => Some(account_id),
            _ => None,
        };

        let mut s = serializer.serialize_struct("AppError", 2 + usize::from(account_id.is_some()))?;
        s.serialize_field("type", error_type)?;
        s.serialize_field("message", &message)?;
        if let Some(account_id) = account_id {
            s.serialize_field("accountId", account_id)?;
        }
        s.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_expired_carries_the_account_to_the_frontend() {
        let value = serde_json::to_value(AppError::TokenExpired {
            account_id: "octocat".into(),
        })
        .unwrap();
        assert_eq!(value["type"], "TokenExpired");
        assert_eq!(value["accountId"], "octocat");
        assert!(value["message"].as_str().unwrap().contains("octocat"));

        let other = serde_json::to_value(AppError::Network("down".into())).unwrap();
        assert!(other.get("accountId").is_none());
    }
}
