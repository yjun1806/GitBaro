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

    #[error("Authentication error: {0}")]
    Auth(String),

    #[error("Token expired for account {account_id}")]
    TokenExpired { account_id: String },

    #[error("Keychain error: {0}")]
    Keychain(String),

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

    #[error("Channel error: {0}")]
    Channel(String),

    #[error("Repository not found: {0}")]
    RepoNotFound(String),
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Network(e.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Keychain(e.to_string())
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
            AppError::GitCli { message, exit_code } => {
                ("GitCli", format!("exit {:?}: {}", exit_code, message))
            }
            AppError::Auth(msg) => ("Auth", msg.clone()),
            AppError::TokenExpired { account_id } => {
                ("TokenExpired", format!("Token expired for {}", account_id))
            }
            AppError::Keychain(msg) => ("Keychain", msg.clone()),
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
            AppError::Channel(msg) => ("Channel", msg.clone()),
            AppError::RepoNotFound(path) => ("RepoNotFound", path.clone()),
        };

        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("type", error_type)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}
