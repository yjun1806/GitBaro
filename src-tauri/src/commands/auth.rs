use crate::error::AppError;
use crate::gh::cli;
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
pub async fn start_gh_login(
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    cli::check_gh_version().await?;

    let handle = app_handle.clone();
    let store = token_store.inner().clone();

    tauri::async_runtime::spawn(async move {
        let handle_for_cb = handle.clone();

        let result = cli::run_gh_login(move |user_code, verification_uri| {
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
            Ok(login_result) => {
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
    let gh_accounts = cli::gh_auth_status().await?;
    let mut accounts = Vec::new();

    for gh_acc in &gh_accounts {
        let enriched = match resolve_token(token_store, &gh_acc.username).await {
            Ok(token) => fetch_github_user_info(&token).await.ok(),
            Err(_) => None,
        };

        let (email, avatar_url) = match enriched {
            Some(info) => (info.email, info.avatar_url),
            None => (String::new(), String::new()),
        };
        let email = if email.is_empty() {
            format!("{}@users.noreply.github.com", gh_acc.username)
        } else {
            email
        };

        accounts.push(json!({
            "id": gh_acc.username,
            "username": gh_acc.username,
            "email": email,
            "avatarUrl": avatar_url,
        }));
    }

    // Cache account metadata for create_commit author lookup
    let _ = save_accounts_cache(&accounts).await;

    Ok(accounts)
}

struct UserInfo {
    email: String,
    avatar_url: String,
}

async fn fetch_github_user_info(token: &str) -> Result<UserInfo, AppError> {
    let client = reqwest::Client::new();
    let auth = format!("Bearer {}", token);

    let user_resp = client
        .get("https://api.github.com/user")
        .header("Authorization", &auth)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "gitbaro/0.1")
        .send()
        .await?;

    if !user_resp.status().is_success() {
        return Err(AppError::Auth("Failed to fetch user info".into()));
    }

    let user: Value = user_resp.json().await?;
    let avatar_url = user["avatar_url"].as_str().unwrap_or("").to_string();
    let mut email = user["email"].as_str().unwrap_or("").to_string();

    // If profile email is empty, try /user/emails
    if email.is_empty() {
        if let Ok(emails_resp) = client
            .get("https://api.github.com/user/emails")
            .header("Authorization", &auth)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "gitbaro/0.1")
            .send()
            .await
        {
            if emails_resp.status().is_success() {
                if let Ok(emails) = emails_resp.json::<Vec<Value>>().await {
                    let primary = emails.iter().find(|e| {
                        e["primary"].as_bool() == Some(true)
                            && e["verified"].as_bool() == Some(true)
                    });
                    let fallback = emails
                        .iter()
                        .find(|e| e["verified"].as_bool() == Some(true));
                    if let Some(entry) = primary.or(fallback) {
                        email = entry["email"].as_str().unwrap_or("").to_string();
                    }
                }
            }
        }
    }

    Ok(UserInfo { email, avatar_url })
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
    let mut mapping = load_json_file(&mapping_path).await.unwrap_or(json!({}));

    let key = format!("{}:{}", repo_path, remote_name);
    mapping[key] = json!(account_id);

    save_json_file(&mapping_path, &mapping).await?;
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
    let mapping = load_json_file(&mapping_path).await.unwrap_or(json!({}));

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

    let token = match resolve_token(&token_store, &account_id).await {
        Ok(t) => t,
        Err(_) => {
            return Ok(
                json!({ "valid": false, "canPush": false, "reason": "token_not_found" }),
            );
        }
    };

    let client = reqwest::Client::new();
    let auth_header = format!("Bearer {}", token);

    // 1. Check token validity
    let user_resp = client
        .get("https://api.github.com/user")
        .header("Authorization", &auth_header)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "gitbaro/0.1")
        .send()
        .await;

    match &user_resp {
        Ok(resp) if !resp.status().is_success() => {
            let status = resp.status().as_u16();
            tracing::warn!("Token invalid for account {}: HTTP {}", account_id, status);
            return Ok(
                json!({ "valid": false, "canPush": false, "reason": "unauthorized" }),
            );
        }
        Err(e) => {
            tracing::warn!("Token validation network error: {}", e);
            return Ok(
                json!({ "valid": false, "canPush": false, "reason": "network_error" }),
            );
        }
        _ => {}
    }

    // 2. If repo_path given, check repo write permission
    if let Some(ref rp) = repo_path {
        let owner_repo = resolve_repo_owner(rp).await;
        if let Some((owner, repo)) = owner_repo {
            let repo_resp = client
                .get(format!(
                    "https://api.github.com/repos/{}/{}",
                    owner, repo
                ))
                .header("Authorization", &auth_header)
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "gitbaro/0.1")
                .send()
                .await;

            match repo_resp {
                Ok(resp) if resp.status().is_success() => {
                    let body: Value = resp.json().await.unwrap_or(json!({}));
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
                    return Ok(json!({ "valid": true, "canPush": can_push }));
                }
                Ok(resp) if resp.status().as_u16() == 404 => {
                    return Ok(json!({ "valid": true, "canPush": false, "reason": "repo_not_found" }));
                }
                _ => {
                    return Ok(json!({ "valid": true, "canPush": false, "reason": "repo_check_failed" }));
                }
            }
        }
    }

    Ok(json!({ "valid": true, "canPush": true }))
}

// ─── Helpers ───

/// Resolve an account (username) to its GitHub token via TokenStore.
pub(crate) async fn resolve_token(
    token_store: &TokenStore,
    account_id: &str,
) -> Result<String, AppError> {
    token_store.get_token(account_id).await
}

/// Resolve owner/repo from a local repo path by reading its origin remote URL.
async fn resolve_repo_owner(repo_path: &str) -> Option<(String, String)> {
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
    crate::git::remote::parse_github_url(&url)
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

async fn load_json_file(path: &std::path::Path) -> Result<Value, AppError> {
    let contents = tokio::fs::read_to_string(path).await?;
    let value = serde_json::from_str(&contents)?;
    Ok(value)
}

async fn save_json_file(path: &std::path::Path, value: &Value) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let contents = serde_json::to_string_pretty(value)?;
    tokio::fs::write(path, contents).await?;
    Ok(())
}

async fn save_accounts_cache(accounts: &[Value]) -> Result<(), AppError> {
    save_json_file(&accounts_cache_path(), &json!(accounts)).await
}

/// Read cached account metadata (used by create_commit for author info).
pub(crate) async fn load_accounts_cache() -> Result<Vec<Value>, AppError> {
    let value = load_json_file(&accounts_cache_path()).await?;
    value
        .as_array()
        .cloned()
        .ok_or_else(|| AppError::Auth("Invalid accounts cache".into()))
}
