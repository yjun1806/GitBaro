use crate::error::AppError;
use crate::github::client::GitHubClient;
use serde_json::Value;

pub async fn list_workflow_runs(
    client: &GitHubClient,
    token: &str,
    owner: &str,
    repo: &str,
    page: u32,
) -> Result<Value, AppError> {
    crate::github::client::validate_path_segment(owner)?;
    crate::github::client::validate_path_segment(repo)?;
    let path = format!("/repos/{}/{}/actions/runs", owner, repo);
    let page_str = page.to_string();
    client
        .get_with_query(token, &path, &[("per_page", "30"), ("page", &page_str)])
        .await
}

pub async fn get_workflow_run_jobs(
    client: &GitHubClient,
    token: &str,
    owner: &str,
    repo: &str,
    run_id: u64,
) -> Result<Value, AppError> {
    crate::github::client::validate_path_segment(owner)?;
    crate::github::client::validate_path_segment(repo)?;
    let path = format!("/repos/{}/{}/actions/runs/{}/jobs", owner, repo, run_id);
    client.get_with_query(token, &path, &[]).await
}
