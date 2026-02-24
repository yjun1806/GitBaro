use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;
use zeroize::Zeroizing;

use crate::error::AppError;
use crate::gh::cli;

/// In-memory token cache for GitHub accounts.
///
/// Tokens are wrapped in `Zeroizing<String>` so memory is zeroed on drop.
/// Uses `tokio::RwLock` for concurrent read access across async tasks.
/// Clone-friendly via inner `Arc` — cloning shares the same cache.
#[derive(Clone)]
pub struct TokenStore {
    cache: Arc<RwLock<HashMap<String, Zeroizing<String>>>>,
}

impl TokenStore {
    pub fn new() -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Return a cached token, or fetch via `gh auth token` on cache miss.
    pub async fn get_token(&self, username: &str) -> Result<String, AppError> {
        // Fast path: read lock
        {
            let cache = self.cache.read().await;
            if let Some(token) = cache.get(username) {
                return Ok(token.as_str().to_string());
            }
        }

        // Cache miss: fetch from gh CLI and cache
        let token = cli::gh_auth_token(username).await?;
        {
            let mut cache = self.cache.write().await;
            cache.insert(username.to_string(), Zeroizing::new(token.clone()));
        }
        tracing::debug!("TokenStore: cached token for {}", username);
        Ok(token)
    }

    /// Force re-fetch from `gh auth token`, replacing any cached value.
    /// Used after a 401 to get a potentially refreshed token.
    pub async fn refresh_token(&self, username: &str) -> Result<String, AppError> {
        let token = cli::gh_auth_token(username).await?;
        {
            let mut cache = self.cache.write().await;
            cache.insert(username.to_string(), Zeroizing::new(token.clone()));
        }
        tracing::debug!("TokenStore: refreshed token for {}", username);
        Ok(token)
    }

    /// Pre-cache a known token (e.g. after login).
    pub async fn set_token(&self, username: &str, token: String) {
        let mut cache = self.cache.write().await;
        cache.insert(username.to_string(), Zeroizing::new(token));
    }

    /// Remove a cached token (e.g. after account removal).
    pub async fn remove_token(&self, username: &str) {
        let mut cache = self.cache.write().await;
        cache.remove(username);
    }
}
