use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::warn;

use crate::error::AppError;

use super::keychain::KeychainManager;
use super::migration::migrate_account_registry;

const APP_DATA_DIR: &str = "com.gitease.app";
const ACCOUNTS_FILE: &str = "accounts.json";
const SCHEMA_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitHubAccount {
    pub id: String,
    pub username: String,
    pub email: String,
    pub avatar_url: String,
    /// Keychain reference key — NOT the actual token.
    pub access_token_ref: String,
    /// Keychain reference key — NOT the actual refresh token.
    pub refresh_token_ref: String,
    /// Unix timestamp (seconds) when the access token expires.
    pub token_expires_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RepoAccountMapping {
    pub repo_path: String,
    /// First-commit hash used to recover a mapping after the repo is moved.
    pub repo_id: Option<String>,
    pub remote_name: String,
    pub account_id: String,
    pub remote_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AccountRegistry {
    pub schema_version: u32,
    pub accounts: Vec<GitHubAccount>,
    pub mappings: Vec<RepoAccountMapping>,
    pub default_account_id: Option<String>,
}

impl Default for AccountRegistry {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            accounts: Vec::new(),
            mappings: Vec::new(),
            default_account_id: None,
        }
    }
}

impl AccountRegistry {
    /// Load the registry from disk, running migrations as needed.
    /// Creates a default registry if the file does not exist.
    pub fn load() -> Result<Self, AppError> {
        let path = Self::registry_path()?;

        if !path.exists() {
            return Ok(Self::default());
        }

        let raw = std::fs::read_to_string(&path)?;
        let registry = migrate_account_registry(&raw)?;
        Ok(registry)
    }

    /// Persist the registry to disk.
    pub fn save(&self) -> Result<(), AppError> {
        let path = Self::registry_path()?;

        // Ensure parent directory exists.
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, json)?;
        Ok(())
    }

    /// Add an account. Replaces an existing account with the same id.
    pub fn add_account(&mut self, account: GitHubAccount) -> Result<(), AppError> {
        self.accounts.retain(|a| a.id != account.id);
        self.accounts.push(account);
        Ok(())
    }

    /// Remove an account by id and clean up its Keychain entries.
    pub fn remove_account(&mut self, account_id: &str) -> Result<(), AppError> {
        if let Some(pos) = self.accounts.iter().position(|a| a.id == account_id) {
            let account = self.accounts.remove(pos);

            if let Err(e) = KeychainManager::delete_token(&account.access_token_ref) {
                warn!("Failed to delete access token from Keychain: {}", e);
            }
            if let Err(e) = KeychainManager::delete_token(&account.refresh_token_ref) {
                warn!("Failed to delete refresh token from Keychain: {}", e);
            }
        }

        // Remove any mappings that referenced this account.
        self.mappings.retain(|m| m.account_id != account_id);

        // Clear default if it pointed to the removed account.
        if self.default_account_id.as_deref() == Some(account_id) {
            self.default_account_id = None;
        }

        Ok(())
    }

    /// Look up an account by id.
    pub fn get_account(&self, account_id: &str) -> Option<&GitHubAccount> {
        self.accounts.iter().find(|a| a.id == account_id)
    }

    /// Insert or replace a repo-to-account mapping.
    pub fn set_repo_mapping(&mut self, mapping: RepoAccountMapping) {
        self.mappings.retain(|m| {
            !(m.repo_path == mapping.repo_path && m.remote_name == mapping.remote_name)
        });
        self.mappings.push(mapping);
    }

    /// Find a mapping by exact repo path and remote name.
    pub fn get_repo_mapping(
        &self,
        repo_path: &str,
        remote_name: &str,
    ) -> Option<&RepoAccountMapping> {
        self.mappings
            .iter()
            .find(|m| m.repo_path == repo_path && m.remote_name == remote_name)
    }

    /// Try to recover a mapping for a repo that has been moved, using the
    /// stored `repo_id` (first-commit hash).  `new_path` is matched against
    /// the mapping's `repo_id` field.
    pub fn resolve_mapping(&self, new_path: &str) -> Option<&RepoAccountMapping> {
        // First try an exact path match (fast path).
        if let Some(m) = self
            .mappings
            .iter()
            .find(|m| m.repo_path == new_path)
        {
            return Some(m);
        }

        // Then try repo_id recovery: caller passes the first-commit hash as `new_path`.
        self.mappings
            .iter()
            .find(|m| m.repo_id.as_deref() == Some(new_path))
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    fn registry_path() -> Result<PathBuf, AppError> {
        let data_dir = dirs::data_dir().ok_or_else(|| {
            AppError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Could not locate user data directory",
            ))
        })?;
        Ok(data_dir.join(APP_DATA_DIR).join(ACCOUNTS_FILE))
    }
}
