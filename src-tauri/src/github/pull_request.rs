use crate::error::AppError;
use crate::github::client::GitHubClient;
use serde_json::Value;

pub async fn list_pull_requests(
    client: &GitHubClient,
    token: &str,
    owner: &str,
    repo: &str,
) -> Result<Vec<Value>, AppError> {
    let path = format!("/repos/{}/{}/pulls", owner, repo);
    let body = client
        .get_with_query(token, &path, &[("state", "open"), ("per_page", "100")])
        .await?;
    Ok(body.as_array().cloned().unwrap_or_default())
}

pub async fn get_pull_request(
    client: &GitHubClient,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<Value, AppError> {
    let path = format!("/repos/{}/{}/pulls/{}", owner, repo, number);
    client.get_with_query(token, &path, &[]).await
}
