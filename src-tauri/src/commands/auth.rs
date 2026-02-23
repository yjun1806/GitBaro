use crate::auth::keychain::KeychainManager;
use crate::auth::oauth::fetch_user_info;
use crate::error::AppError;
use serde_json::{json, Value};

/// GitHub App Client ID — replace with your actual Client ID after creating the app.
const CLIENT_ID: &str = "Iv23liPCP9M7lm3HwbUM";

// ─── Device Flow ───

#[tauri::command]
pub async fn start_device_flow() -> Result<Value, AppError> {
    let client = reqwest::Client::new();

    let response = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", CLIENT_ID), ("scope", "repo user:email read:org")])
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!("Device flow start failed: {}", body)));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    tracing::info!(
        "Device flow started: user_code={}",
        body["user_code"].as_str().unwrap_or("?")
    );

    Ok(body)
}

#[tauri::command]
pub async fn poll_device_flow(device_code: String) -> Result<Value, AppError> {
    let client = reqwest::Client::new();

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", CLIENT_ID),
            ("device_code", device_code.as_str()),
            (
                "grant_type",
                "urn:ietf:params:oauth:grant-type:device_code",
            ),
        ])
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    let body: Value = response
        .json()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    // GitHub returns error field while user hasn't approved yet
    if let Some(error) = body.get("error").and_then(|e| e.as_str()) {
        return Ok(json!({
            "status": error,
            "message": body.get("error_description").and_then(|d| d.as_str()).unwrap_or(""),
        }));
    }

    // Success — we have access_token
    let access_token = body["access_token"]
        .as_str()
        .ok_or_else(|| AppError::Auth("No access_token in response".to_string()))?;

    // Fetch user info
    let user = fetch_user_info(access_token).await?;

    // Store token in Keychain
    let token_ref = KeychainManager::generate_token_ref();
    KeychainManager::store_token(&token_ref, access_token)?;

    // Save account to registry
    let user_id = user.id.to_string();
    let email = user.email.clone().unwrap_or_default();
    let account = json!({
        "id": user_id,
        "username": user.login,
        "email": email,
        "avatarUrl": user.avatar_url,
        "tokenRef": token_ref,
    });

    let mut registry = load_account_registry().await?;
    if let Some(arr) = registry.as_array_mut() {
        arr.retain(|a| a["id"].as_str() != Some(&user_id));
        arr.push(account.clone());
    } else {
        registry = json!([account]);
    }
    save_account_registry(&registry).await?;

    tracing::info!("Login complete: user={}", user.login);

    Ok(json!({
        "status": "success",
        "account": {
            "id": user_id,
            "username": user.login,
            "email": email,
            "avatarUrl": user.avatar_url,
        },
    }))
}

// ─── Account Management ───

#[tauri::command]
pub async fn get_accounts() -> Result<Vec<Value>, AppError> {
    let registry = load_account_registry().await?;
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

    // Find and remove token from keychain
    if let Some(arr) = registry.as_array() {
        if let Some(account) = arr.iter().find(|a| a["id"].as_str() == Some(&account_id)) {
            if let Some(token_ref) = account["tokenRef"].as_str() {
                let _ = KeychainManager::delete_token(token_ref);
            }
        }
    }

    if let Some(arr) = registry.as_array_mut() {
        arr.retain(|a| a["id"].as_str() != Some(&account_id));
    }

    save_account_registry(&registry).await?;
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
        .map(|a| {
            json!({
                "id": a["id"],
                "username": a.get("username")
                    .or_else(|| a.get("login"))
                    .unwrap_or(&Value::Null),
                "email": a["email"],
                "avatarUrl": a.get("avatar_url")
                    .or_else(|| a.get("avatarUrl"))
                    .unwrap_or(&Value::Null),
            })
        });

    Ok(account)
}

#[tauri::command]
pub async fn refresh_token(account_id: String) -> Result<(), AppError> {
    tracing::info!(
        "refresh_token called for {} (no-op for GitHub App device flow)",
        account_id
    );
    Ok(())
}

// ─── Helpers ───

fn app_support_dir() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.gitbaro.app")
}

fn account_registry_path() -> std::path::PathBuf {
    app_support_dir().join("accounts.json")
}

fn repo_account_mapping_path() -> std::path::PathBuf {
    app_support_dir().join("repo_accounts.json")
}

pub(crate) async fn load_account_registry() -> Result<Value, AppError> {
    load_json_file(&account_registry_path())
        .await
        .map(|v| {
            if v.is_array() {
                v
            } else if let Some(accounts) = v.get("accounts") {
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

/// Resolve an account ID to its access token from the keychain.
pub(crate) async fn resolve_token(account_id: &str) -> Result<String, AppError> {
    let registry = load_account_registry().await?;
    let account = registry
        .as_array()
        .and_then(|arr| arr.iter().find(|a| a["id"].as_str() == Some(account_id)))
        .ok_or_else(|| AppError::Auth(format!("Account '{}' not found", account_id)))?;

    let token_ref = account["tokenRef"]
        .as_str()
        .ok_or_else(|| AppError::Auth("No tokenRef for account".to_string()))?;

    KeychainManager::retrieve_token(token_ref)
}
