use crate::commands::auth::{resolve_repo_owner, resolve_token};
use crate::error::AppError;
use crate::github::client::GitHubClient;
use crate::state::token_store::TokenStore;
use serde::Serialize;

// ─── Types ───

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    pub id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub head_branch: String,
    pub head_sha: String,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    pub run_number: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowJob {
    pub id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub steps: Vec<JobStep>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JobStep {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub number: u64,
}

// ─── Commands ───

#[tauri::command]
pub async fn list_workflow_runs(
    repo_path: String,
    account_id: String,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Vec<WorkflowRun>, AppError> {
    let (owner, repo) = resolve_repo_owner(&repo_path)
        .await
        .ok_or_else(|| AppError::Auth("Could not resolve owner/repo from remote URL".into()))?;

    let token = resolve_token(&token_store, &account_id).await?;
    let client = GitHubClient::new();
    let body = crate::github::actions::list_workflow_runs(&client, &token, &owner, &repo, 1).await?;

    let runs = body["workflow_runs"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| {
            Some(WorkflowRun {
                id: v["id"].as_u64()?,
                name: v["name"].as_str().unwrap_or("").to_string(),
                status: v["status"].as_str().unwrap_or("").to_string(),
                conclusion: v["conclusion"].as_str().map(|s| s.to_string()),
                head_branch: v["head_branch"].as_str().unwrap_or("").to_string(),
                head_sha: v["head_sha"].as_str().unwrap_or("").to_string(),
                html_url: v["html_url"].as_str().unwrap_or("").to_string(),
                created_at: v["created_at"].as_str().unwrap_or("").to_string(),
                updated_at: v["updated_at"].as_str().unwrap_or("").to_string(),
                run_number: v["run_number"].as_u64().unwrap_or(0),
            })
        })
        .collect();

    Ok(runs)
}

#[tauri::command]
pub async fn get_workflow_run_jobs(
    repo_path: String,
    account_id: String,
    run_id: u64,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Vec<WorkflowJob>, AppError> {
    let (owner, repo) = resolve_repo_owner(&repo_path)
        .await
        .ok_or_else(|| AppError::Auth("Could not resolve owner/repo from remote URL".into()))?;

    let token = resolve_token(&token_store, &account_id).await?;
    let client = GitHubClient::new();
    let body =
        crate::github::actions::get_workflow_run_jobs(&client, &token, &owner, &repo, run_id)
            .await?;

    let jobs = body["jobs"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| {
            let steps = v["steps"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|s| {
                    Some(JobStep {
                        name: s["name"].as_str()?.to_string(),
                        status: s["status"].as_str().unwrap_or("").to_string(),
                        conclusion: s["conclusion"].as_str().map(|c| c.to_string()),
                        number: s["number"].as_u64().unwrap_or(0),
                    })
                })
                .collect();

            Some(WorkflowJob {
                id: v["id"].as_u64()?,
                name: v["name"].as_str().unwrap_or("").to_string(),
                status: v["status"].as_str().unwrap_or("").to_string(),
                conclusion: v["conclusion"].as_str().map(|s| s.to_string()),
                started_at: v["started_at"].as_str().map(|s| s.to_string()),
                completed_at: v["completed_at"].as_str().map(|s| s.to_string()),
                steps,
            })
        })
        .collect();

    Ok(jobs)
}
