use crate::error::AppError;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const CLIENT_ID: &str = "Ov23liXXXXXXXXXXXXXX"; // Placeholder — set via env or config
const REDIRECT_URI: &str = "http://localhost:7878/callback";
const SCOPE: &str = "repo user:email read:org";

fn generate_pkce() -> (String, String) {
    let mut verifier_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut verifier_bytes);
    let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);

    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

    (verifier, challenge)
}

#[tauri::command]
pub async fn start_oauth() -> Result<Value, AppError> {
    let (verifier, challenge) = generate_pkce();
    let state: String = {
        let mut bytes = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut bytes);
        URL_SAFE_NO_PAD.encode(bytes)
    };

    let auth_url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        CLIENT_ID,
        urlencoding_simple(REDIRECT_URI),
        urlencoding_simple(SCOPE),
        state,
        challenge,
    );

    tracing::info!("OAuth flow started, state={}", state);

    Ok(json!({
        "authUrl": auth_url,
        "state": state,
        "codeVerifier": verifier,
        "redirectUri": REDIRECT_URI,
    }))
}

/// Minimal percent-encoding for URL query values (encodes space, /, :, @)
fn urlencoding_simple(s: &str) -> String {
    let mut encoded = String::new();
    for c in s.chars() {
        match c {
            ' ' => encoded.push_str("%20"),
            ':' => encoded.push_str("%3A"),
            '/' => encoded.push_str("%2F"),
            '@' => encoded.push_str("%40"),
            _ => encoded.push(c),
        }
    }
    encoded
}

#[tauri::command]
pub async fn get_accounts() -> Result<Vec<Value>, AppError> {
    let registry = load_account_registry().await?;
    // Strip tokens before returning
    let accounts: Vec<Value> = registry
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|account| {
                    json!({
                        "id": account["id"],
                        "username": account.get("username")
                            .or_else(|| account.get("login"))
                            .unwrap_or(&Value::Null),
                        "email": account["email"],
                        "avatarUrl": account.get("avatar_url")
                            .or_else(|| account.get("avatarUrl"))
                            .unwrap_or(&Value::Null),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(accounts)
}

#[tauri::command]
pub async fn remove_account(account_id: String) -> Result<(), AppError> {
    let mut registry = load_account_registry().await?;

    if let Some(arr) = registry.as_array_mut() {
        arr.retain(|a| a["id"].as_str() != Some(&account_id));
    }

    save_account_registry(&registry).await?;

    // Remove token from keychain
    let entry = keyring::Entry::new("gitease", &account_id)?;
    let _ = entry.delete_credential(); // ignore error if not found

    tracing::info!("Removed account: {}", account_id);
    Ok(())
}

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
    tracing::info!("Set account {} for repo {} remote {}", account_id, repo_path, remote_name);
    Ok(())
}

#[tauri::command]
pub async fn get_repo_account(
    repo_path: String,
    remote_name: String,
) -> Result<Option<Value>, AppError> {
    let mapping_path = repo_account_mapping_path();
    let mapping = load_json_file(&mapping_path).await.unwrap_or(json!({}));

    let key = format!("{}:{}", repo_path, remote_name);
    let account_id = match mapping[&key].as_str() {
        Some(id) => id.to_string(),
        None => return Ok(None),
    };

    let registry = load_account_registry().await?;
    let account = registry
        .as_array()
        .and_then(|arr| arr.iter().find(|a| a["id"].as_str() == Some(&account_id)))
        .map(|a| json!({
            "id": a["id"],
            "username": a.get("username")
                .or_else(|| a.get("login"))
                .unwrap_or(&Value::Null),
            "email": a["email"],
            "avatarUrl": a.get("avatar_url")
                .or_else(|| a.get("avatarUrl"))
                .unwrap_or(&Value::Null),
        }));

    Ok(account)
}

#[tauri::command]
pub async fn refresh_token(account_id: String) -> Result<(), AppError> {
    // GitHub's OAuth tokens do not expire unless revoked.
    // This is a no-op stub for future support of fine-grained PATs or GitHub Apps.
    tracing::info!("refresh_token called for {} (no-op for GitHub OAuth)", account_id);
    Ok(())
}

// --- Helpers ---

fn app_support_dir() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.gitease.app")
}

fn account_registry_path() -> std::path::PathBuf {
    app_support_dir().join("accounts.json")
}

fn repo_account_mapping_path() -> std::path::PathBuf {
    app_support_dir().join("repo_accounts.json")
}

async fn load_account_registry() -> Result<Value, AppError> {
    load_json_file(&account_registry_path())
        .await
        .map(|v| {
            if v.is_array() {
                v
            } else if let Some(accounts) = v.get("accounts") {
                // AccountRegistry struct format: { schema_version, accounts: [...], ... }
                accounts.clone()
            } else {
                json!([])
            }
        })
        .or_else(|_| Ok(json!([])))
}

async fn save_account_registry(registry: &Value) -> Result<(), AppError> {
    save_json_file(&account_registry_path(), registry).await
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
