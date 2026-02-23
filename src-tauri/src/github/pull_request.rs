use crate::error::AppError;
use crate::github::client::GitHubClient;
use serde_json::Value;

pub async fn list_pull_requests(
    _client: &GitHubClient,
    token: &str,
    owner: &str,
    repo: &str,
) -> Result<Vec<Value>, AppError> {
    // Use the client's internal get method via a public wrapper
    // We expose this as a free function to keep the client struct focused
    let url = format!("/repos/{}/{}/pulls", owner, repo);
    // Call the GitHub API via a temporary client instance
    let http = reqwest::Client::builder()
        .user_agent("GitEase/0.1.0")
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;

    let response = http
        .get(format!("https://api.github.com{}", url))
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {}", token))
        .header("X-GitHub-Api-Version", "2022-11-28")
        .query(&[("state", "open"), ("per_page", "100")])
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

    let prs: Value = response.json().await?;
    Ok(prs.as_array().cloned().unwrap_or_default())
}

pub async fn get_pull_request(
    _client: &GitHubClient,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<Value, AppError> {
    let http = reqwest::Client::builder()
        .user_agent("GitEase/0.1.0")
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;

    let url = format!(
        "https://api.github.com/repos/{}/{}/pulls/{}",
        owner, repo, number
    );

    let response = http
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {}", token))
        .header("X-GitHub-Api-Version", "2022-11-28")
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

    let pr: Value = response.json().await?;
    Ok(pr)
}
