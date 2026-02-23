use crate::error::AppError;
use crate::github::client::GitHubClient;
use serde_json::Value;

/// List notifications for the authenticated user.
pub async fn list_notifications(
    _client: &GitHubClient,
    token: &str,
    all: bool,
) -> Result<Vec<Value>, AppError> {
    let http = reqwest::Client::builder()
        .user_agent("GitBaro/0.1.0")
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;

    let all_str = if all { "true" } else { "false" };

    let response = http
        .get("https://api.github.com/notifications")
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {}", token))
        .header("X-GitHub-Api-Version", "2022-11-28")
        .query(&[("all", all_str), ("per_page", "50")])
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        let status_code = status.as_u16();
        let body: Value = response
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({"message": "Unknown error"}));
        let message = body["message"]
            .as_str()
            .unwrap_or("GitHub API error")
            .to_string();
        return Err(AppError::GithubApi {
            status: status_code,
            message,
        });
    }

    let notifications: Value = response.json().await?;
    Ok(notifications.as_array().cloned().unwrap_or_default())
}

/// Mark a notification thread as read.
pub async fn mark_notification_read(
    _client: &GitHubClient,
    token: &str,
    thread_id: u64,
) -> Result<(), AppError> {
    let http = reqwest::Client::builder()
        .user_agent("GitBaro/0.1.0")
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;

    let url = format!(
        "https://api.github.com/notifications/threads/{}",
        thread_id
    );

    let response = http
        .patch(&url)
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {}", token))
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("Content-Length", "0")
        .send()
        .await?;

    let status = response.status();
    // 205 Reset Content is the expected success response
    if !status.is_success() && status.as_u16() != 205 {
        let status_code = status.as_u16();
        return Err(AppError::GithubApi {
            status: status_code,
            message: "Failed to mark notification as read".to_string(),
        });
    }

    Ok(())
}
