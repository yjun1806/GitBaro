use std::future::Future;

use crate::error::AppError;
use crate::gh::cli;
use crate::github::client::{is_unauthorized, GitHubClient};
use crate::state::json_file;
use crate::state::TokenStore;
use serde_json::{json, Value};
use tauri::Emitter;

// ─── GH Status ───

#[tauri::command]
pub async fn check_gh_status() -> Result<Value, AppError> {
    let version = match cli::check_gh_version().await {
        Ok(v) => v,
        Err(AppError::GhCliNotFound) => {
            return Ok(json!({
                "installed": false,
                "version": null,
                "loggedIn": false,
                "accounts": [],
            }));
        }
        Err(AppError::GhVersionTooOld(msg)) => {
            return Ok(json!({
                "installed": true,
                "version": msg,
                "loggedIn": false,
                "accounts": [],
                "versionError": true,
            }));
        }
        Err(e) => return Err(e),
    };

    let accounts = cli::gh_auth_status().await.unwrap_or_default();
    let logged_in = !accounts.is_empty();

    Ok(json!({
        "installed": true,
        "version": version,
        "loggedIn": logged_in,
        "accounts": accounts,
    }))
}

// ─── Login ───

#[tauri::command]
/// Start `gh auth login` in the background and return the login id, which the
/// frontend passes to `cancel_gh_login` when the dialog closes.
pub async fn start_gh_login(
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<u64, AppError> {
    cli::check_gh_version().await?;

    let handle = app_handle.clone();
    let store = token_store.inner().clone();
    let (login_id, cancel) = cli::begin_login();

    tauri::async_runtime::spawn(async move {
        let handle_for_cb = handle.clone();

        let result = cli::run_gh_login(login_id, cancel, move |user_code, verification_uri| {
            let _ = handle_for_cb.emit(
                "gh-login:device-code",
                json!({
                    "userCode": user_code,
                    "verificationUri": verification_uri,
                }),
            );
        })
        .await;

        match result {
            // Cancelled: the dialog is gone, so there is nobody to notify.
            Ok(None) => {}
            Ok(Some(login_result)) => {
                // Pre-cache the new account's token
                if let Ok(token) = cli::gh_auth_token(&login_result.username).await {
                    store.set_token(&login_result.username, token).await;
                    tracing::debug!(
                        "Pre-cached token for newly logged-in account: {}",
                        login_result.username
                    );
                }

                let _ = handle.emit(
                    "gh-login:complete",
                    json!({ "username": login_result.username }),
                );
            }
            Err(e) => {
                let _ = handle.emit(
                    "gh-login:error",
                    json!({ "message": e.to_string() }),
                );
            }
        }
    });

    Ok(login_id)
}

/// Stop the `gh auth login` process started with `login_id`, if still running.
#[tauri::command]
pub async fn cancel_gh_login(login_id: u64) -> Result<(), AppError> {
    cli::cancel_login(login_id);
    Ok(())
}

// ─── Account Management ───

#[tauri::command]
pub async fn get_accounts(
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Vec<Value>, AppError> {
    let result = get_accounts_internal(&token_store).await;
    match &result {
        Ok(accounts) => tracing::debug!("get_accounts: returning {} accounts", accounts.len()),
        Err(e) => tracing::warn!("get_accounts: error: {}", e),
    }
    result
}

async fn get_accounts_internal(
    token_store: &TokenStore,
) -> Result<Vec<Value>, AppError> {
    // gh lists every configured account, including ones whose online check
    // failed (offline, revoked token), so this is never an empty "degraded" list.
    let gh_accounts = cli::gh_auth_status().await?;
    let client = GitHubClient::new();

    let mut fetched = Vec::with_capacity(gh_accounts.len());
    for gh_acc in &gh_accounts {
        let info = call_with_token_retry(token_store, &gh_acc.username, |token| {
            let client = &client;
            async move { fetch_github_user_info(client, &token).await }
        })
        .await;
        if let Err(e) = &info {
            tracing::warn!("Could not fetch GitHub profile for {}: {}", gh_acc.username, e);
        }
        fetched.push((gh_acc.username.clone(), info.ok()));
    }

    // Merge with the cache under the state-file lock: accounts whose profile
    // could not be fetched keep their previously cached email/avatar.
    let _guard = json_file::lock().await;
    let cached = match load_accounts_cache().await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Ignoring unreadable accounts cache: {}", e);
            Vec::new()
        }
    };
    let accounts = merge_accounts(&fetched, &cached);

    if let Err(e) = json_file::write_json_atomic(&accounts_cache_path(), &accounts).await {
        tracing::warn!("Failed to save accounts cache: {}", e);
    }

    Ok(accounts)
}

/// Build the account list from fresh profile data, falling back to the cached
/// entry for any account whose profile fetch failed.
fn merge_accounts(fetched: &[(String, Option<UserInfo>)], cached: &[Value]) -> Vec<Value> {
    fetched
        .iter()
        .map(|(username, info)| {
            let cached_entry = cached
                .iter()
                .find(|c| c["id"].as_str() == Some(username.as_str()));
            let cached_field = |field: &str| {
                cached_entry
                    .and_then(|c| c[field].as_str())
                    .filter(|v| !v.is_empty())
                    .map(str::to_string)
            };
            let (email, avatar_url) = match info {
                Some(info) => (info.email.clone(), info.avatar_url.clone()),
                None => (
                    cached_field("email").unwrap_or_else(|| noreply_email(None, username)),
                    cached_field("avatarUrl").unwrap_or_default(),
                ),
            };
            json!({
                "id": username,
                "username": username,
                "email": email,
                "avatarUrl": avatar_url,
            })
        })
        .collect()
}

struct UserInfo {
    email: String,
    avatar_url: String,
}

/// GitHub's noreply commit address. Accounts created after July 2017 need the
/// `ID+login` form; the bare `login@` form is only a fallback when no id is known.
fn noreply_email(id: Option<u64>, login: &str) -> String {
    match id {
        Some(id) => format!("{}+{}@users.noreply.github.com", id, login),
        None => format!("{}@users.noreply.github.com", login),
    }
}

/// Commit email for a `/user` response: the public profile email, or the
/// noreply address when the user keeps their email private. Never the private
/// primary email, which GitHub rejects on push when email privacy is enforced.
fn user_info_from_profile(user: &Value) -> UserInfo {
    let login = user["login"].as_str().unwrap_or("");
    let email = user["email"]
        .as_str()
        .filter(|e| !e.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| noreply_email(user["id"].as_u64(), login));
    UserInfo {
        email,
        avatar_url: user["avatar_url"].as_str().unwrap_or("").to_string(),
    }
}

async fn fetch_github_user_info(client: &GitHubClient, token: &str) -> Result<UserInfo, AppError> {
    let user = client.get_user(token).await?;
    Ok(user_info_from_profile(&user))
}

#[tauri::command]
pub async fn remove_account(
    account_id: String,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    cli::gh_auth_logout(&account_id).await?;
    token_store.remove_token(&account_id).await;
    tracing::info!("Removed account: {}", account_id);
    Ok(())
}

// ─── Repo ↔ Account Mapping ───

#[tauri::command]
pub async fn set_repo_account(
    repo_path: String,
    remote_name: String,
    account_id: String,
) -> Result<(), AppError> {
    let mapping_path = repo_account_mapping_path();
    let _guard = json_file::lock().await;
    // A damaged file is an error, never "{}": overwriting it would silently drop
    // every other repository's account assignment.
    let mut mapping = match json_file::read_json(&mapping_path).await? {
        Some(Value::Object(map)) => map,
        None => serde_json::Map::new(),
        Some(_) => {
            return Err(AppError::Auth(
                "repo_accounts.json is not a JSON object".into(),
            ))
        }
    };

    let key = format!("{}:{}", repo_path, remote_name);
    mapping.insert(key, json!(account_id));

    json_file::write_json_atomic(&mapping_path, &mapping).await?;
    tracing::info!(
        "Set account {} for repo {} remote {}",
        account_id,
        repo_path,
        remote_name
    );
    Ok(())
}

#[tauri::command]
pub async fn get_repo_account(
    repo_path: String,
    remote_name: String,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Option<Value>, AppError> {
    let mapping_path = repo_account_mapping_path();
    let mapping = json_file::read_json(&mapping_path)
        .await?
        .unwrap_or_else(|| json!({}));

    let key = format!("{}:{}", repo_path, remote_name);
    let account_id = match mapping[&key].as_str() {
        Some(id) => id.to_string(),
        None => return Ok(None),
    };

    let accounts = get_accounts_internal(&token_store).await?;
    let account = accounts
        .iter()
        .find(|a| a["id"].as_str() == Some(&account_id))
        .cloned();

    Ok(account)
}

// ─── Token Validation ───

#[tauri::command]
pub async fn validate_token(
    account_id: String,
    repo_path: Option<String>,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Value, AppError> {
    tracing::info!(
        "validate_token: account_id={}, repo_path={:?}",
        account_id,
        repo_path
    );

    // Resolve the remote before touching the GitHub token: a non-GitHub remote
    // (GitLab, GHE, no origin) syncs through the user's own credentials, so the
    // GitHub token's state or api.github.com reachability must not block it.
    let github_repo = match &repo_path {
        Some(rp) => match resolve_repo_owner(rp).await {
            Some(pair) => Some(pair),
            None => {
                return Ok(json!({ "valid": true, "canPush": null, "reason": "not_github" }));
            }
        },
        None => None,
    };

    if resolve_token(&token_store, &account_id).await.is_err() {
        return Ok(json!({ "valid": false, "canPush": false, "reason": "token_not_found" }));
    }

    let client = GitHubClient::new();

    // 1. Check token validity (refreshing the cached token once on 401)
    let user = call_with_token_retry(&token_store, &account_id, |token| {
        let client = &client;
        async move { client.get_user(&token).await }
    })
    .await;
    match user {
        Ok(_) => {}
        Err(AppError::Network(e)) => {
            tracing::warn!("Token validation network error: {}", e);
            return Ok(json!({ "valid": false, "canPush": false, "reason": "network_error" }));
        }
        Err(e) => {
            tracing::warn!("Token invalid for account {}: {}", account_id, e);
            return Ok(json!({ "valid": false, "canPush": false, "reason": "unauthorized" }));
        }
    }

    // 2. If a GitHub repo was given, check repo write permission
    let Some((owner, repo)) = github_repo else {
        return Ok(json!({ "valid": true, "canPush": true }));
    };

    let repo_resp = call_with_token_retry(&token_store, &account_id, |token| {
        let (client, owner, repo) = (&client, &owner, &repo);
        async move { client.get_repo(&token, owner, repo).await }
    })
    .await;

    match repo_resp {
        Ok(body) => {
            let can_push = body
                .get("permissions")
                .and_then(|p| p.get("push"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            tracing::info!(
                "Repo {}/{} permissions for {}: push={}",
                owner,
                repo,
                account_id,
                can_push
            );
            Ok(json!({ "valid": true, "canPush": can_push }))
        }
        Err(AppError::GithubApi { status: 404, .. }) => {
            Ok(json!({ "valid": true, "canPush": false, "reason": "repo_not_found" }))
        }
        Err(_) => Ok(json!({ "valid": true, "canPush": false, "reason": "repo_check_failed" })),
    }
}

// ─── Helpers ───

/// Resolve an account (username) to its GitHub token via TokenStore.
pub(crate) async fn resolve_token(
    token_store: &TokenStore,
    account_id: &str,
) -> Result<String, AppError> {
    token_store.get_token(account_id).await
}

/// Run a GitHub API call with the account's token. On HTTP 401 the cached token
/// is refreshed from `gh` (it may have been rotated or re-issued) and the call
/// is retried exactly once.
pub(crate) async fn call_with_token_retry<T, F, Fut>(
    token_store: &TokenStore,
    account_id: &str,
    call: F,
) -> Result<T, AppError>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<T, AppError>>,
{
    let token = resolve_token(token_store, account_id).await?;
    match call(token).await {
        Err(e) if is_unauthorized(&e) => {
            tracing::warn!(
                "GitHub API returned 401 for {}; refreshing token and retrying once",
                account_id
            );
            let fresh = token_store.refresh_token(account_id).await?;
            call(fresh).await
        }
        other => other,
    }
}

/// Resolve owner/repo from a local repo path by reading its origin remote URL.
pub(crate) async fn resolve_repo_owner(repo_path: &str) -> Option<(String, String)> {
    tracing::info!("[git] git remote get-url origin (cwd: {})", repo_path);
    let output = tokio::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // May run `ssh -G` to resolve a host alias, so keep it off the async workers.
    tokio::task::spawn_blocking(move || crate::git::remote::parse_github_url(&url))
        .await
        .ok()
        .flatten()
}

fn app_support_dir() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.gitbaro.app")
}

fn repo_account_mapping_path() -> std::path::PathBuf {
    app_support_dir().join("repo_accounts.json")
}

fn accounts_cache_path() -> std::path::PathBuf {
    app_support_dir().join("gh_accounts_cache.json")
}

/// Read cached account metadata (used by create_commit for author info).
/// A missing cache is an empty list.
pub(crate) async fn load_accounts_cache() -> Result<Vec<Value>, AppError> {
    match json_file::read_json(&accounts_cache_path()).await? {
        None => Ok(Vec::new()),
        Some(value) => value
            .as_array()
            .cloned()
            .ok_or_else(|| AppError::Auth("Invalid accounts cache".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_email_uses_id_plus_login_noreply() {
        let info = user_info_from_profile(&json!({
            "login": "octocat", "id": 583231, "email": null, "avatar_url": "a"
        }));
        assert_eq!(info.email, "583231+octocat@users.noreply.github.com");
        assert_eq!(info.avatar_url, "a");
    }

    #[test]
    fn public_profile_email_is_kept() {
        let info = user_info_from_profile(&json!({
            "login": "octocat", "id": 1, "email": "octo@example.com"
        }));
        assert_eq!(info.email, "octo@example.com");
    }

    #[test]
    fn failed_profile_fetch_keeps_cached_email() {
        let cached = vec![json!({
            "id": "octocat", "username": "octocat",
            "email": "583231+octocat@users.noreply.github.com", "avatarUrl": "cached"
        })];
        let fetched = vec![
            ("octocat".to_string(), None),
            (
                "fresh".to_string(),
                Some(UserInfo { email: "f@example.com".into(), avatar_url: "new".into() }),
            ),
            ("unknown".to_string(), None),
        ];
        let accounts = merge_accounts(&fetched, &cached);
        assert_eq!(accounts[0]["email"], "583231+octocat@users.noreply.github.com");
        assert_eq!(accounts[0]["avatarUrl"], "cached");
        assert_eq!(accounts[1]["email"], "f@example.com");
        assert_eq!(accounts[2]["email"], "unknown@users.noreply.github.com");
    }
}
