use crate::error::AppError;
use crate::github::client::GitHubClient;
use serde_json::Value;

/// List issues for a repository (open by default).
pub async fn list_issues(
    client: &GitHubClient,
    token: &str,
    owner: &str,
    repo: &str,
) -> Result<Vec<Value>, AppError> {
    let path = format!("/repos/{}/{}/issues", owner, repo);
    let body = client
        .get_with_query(token, &path, &[("state", "open"), ("per_page", "100")])
        .await?;
    Ok(body.as_array().cloned().unwrap_or_default())
}

/// Get a single issue by number.
pub async fn get_issue(
    client: &GitHubClient,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<Value, AppError> {
    let path = format!("/repos/{}/{}/issues/{}", owner, repo, number);
    client.get_with_query(token, &path, &[]).await
}
