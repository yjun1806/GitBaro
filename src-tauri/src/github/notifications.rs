use crate::error::AppError;
use crate::github::client::GitHubClient;
use serde_json::Value;

/// List notifications for the authenticated user.
pub async fn list_notifications(
    client: &GitHubClient,
    token: &str,
    all: bool,
) -> Result<Vec<Value>, AppError> {
    let all_str = if all { "true" } else { "false" };
    let body = client
        .get_with_query(
            token,
            "/notifications",
            &[("all", all_str), ("per_page", "50")],
        )
        .await?;
    Ok(body.as_array().cloned().unwrap_or_default())
}

/// Mark a notification thread as read.
pub async fn mark_notification_read(
    client: &GitHubClient,
    token: &str,
    thread_id: u64,
) -> Result<(), AppError> {
    let path = format!("/notifications/threads/{}", thread_id);
    client.patch_empty(token, &path).await
}
