use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::RwLock;
use zeroize::Zeroizing;

use crate::error::AppError;
use crate::gh::cli;

/// How long a cached token is served before `gh auth token` is asked again.
/// `gh auth logout`, `gh auth refresh` or a re-login in a terminal do not
/// revoke the old token, so GitHub keeps accepting it and no 401 ever tells us
/// to refresh. Re-reading after this interval picks up such changes.
const TOKEN_TTL: Duration = Duration::from_secs(60);

struct CachedToken {
    token: Zeroizing<String>,
    fetched_at: Instant,
}

impl CachedToken {
    fn new(token: String) -> Self {
        Self {
            token: Zeroizing::new(token),
            fetched_at: Instant::now(),
        }
    }
}

/// In-memory token cache for GitHub accounts. `gh` stays the source of truth:
/// entries expire after `TOKEN_TTL` and are dropped for accounts `gh` no longer lists.
///
/// Tokens are wrapped in `Zeroizing<String>` so memory is zeroed on drop.
/// Uses `tokio::RwLock` for concurrent read access across async tasks.
/// Clone-friendly via inner `Arc` — cloning shares the same cache.
#[derive(Clone)]
pub struct TokenStore {
    cache: Arc<RwLock<HashMap<String, CachedToken>>>,
    ttl: Duration,
}

impl Default for TokenStore {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenStore {
    pub fn new() -> Self {
        Self::with_ttl(TOKEN_TTL)
    }

    fn with_ttl(ttl: Duration) -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            ttl,
        }
    }

    /// The cached token for `username` if it is younger than the TTL.
    async fn fresh_cached(&self, username: &str) -> Option<String> {
        let cache = self.cache.read().await;
        cache
            .get(username)
            .filter(|c| c.fetched_at.elapsed() < self.ttl)
            .map(|c| c.token.as_str().to_string())
    }

    /// Return a cached token, or fetch via `gh auth token` on a miss or once
    /// the cached one has expired.
    pub async fn get_token(&self, username: &str) -> Result<String, AppError> {
        if let Some(token) = self.fresh_cached(username).await {
            return Ok(token);
        }

        match cli::gh_auth_token(username).await {
            Ok(token) => {
                self.set_token(username, token.clone()).await;
                tracing::debug!("TokenStore: cached token for {}", username);
                Ok(token)
            }
            Err(e) => {
                // Logged out in a terminal: never fall back to the stale token.
                self.remove_token(username).await;
                Err(e)
            }
        }
    }

    /// Force re-fetch from `gh auth token`, replacing any cached value.
    /// Used after a 401 to get a potentially refreshed token.
    pub async fn refresh_token(&self, username: &str) -> Result<String, AppError> {
        let token = match cli::gh_auth_token(username).await {
            Ok(token) => token,
            Err(e) => {
                self.remove_token(username).await;
                return Err(e);
            }
        };
        self.set_token(username, token.clone()).await;
        tracing::debug!("TokenStore: refreshed token for {}", username);
        Ok(token)
    }

    /// Pre-cache a known token (e.g. after login).
    pub async fn set_token(&self, username: &str, token: String) {
        let mut cache = self.cache.write().await;
        cache.insert(username.to_string(), CachedToken::new(token));
    }

    /// Remove a cached token (e.g. after account removal).
    pub async fn remove_token(&self, username: &str) {
        let mut cache = self.cache.write().await;
        cache.remove(username);
    }

    /// Drop cached tokens for accounts `gh auth status` no longer lists
    /// (e.g. after `gh auth logout` in a terminal).
    pub async fn retain_accounts(&self, usernames: &[String]) {
        let mut cache = self.cache.write().await;
        cache.retain(|name, _| usernames.iter().any(|u| u == name));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cached_token_is_served_until_it_expires() {
        let store = TokenStore::new();
        store.set_token("alice", "t1".into()).await;
        assert_eq!(store.fresh_cached("alice").await.as_deref(), Some("t1"));

        let expired = TokenStore::with_ttl(Duration::ZERO);
        expired.set_token("alice", "t1".into()).await;
        assert_eq!(expired.fresh_cached("alice").await, None);
    }

    #[tokio::test]
    async fn retain_accounts_drops_logged_out_accounts() {
        let store = TokenStore::new();
        store.set_token("alice", "a".into()).await;
        store.set_token("bob", "b".into()).await;
        store.retain_accounts(&["bob".to_string()]).await;
        assert_eq!(store.fresh_cached("alice").await, None);
        assert_eq!(store.fresh_cached("bob").await.as_deref(), Some("b"));
    }
}
