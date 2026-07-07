use std::collections::HashMap;

use crate::error::AppError;
use serde_json::Value;

const GITHUB_API_BASE: &str = "https://api.github.com";
const GITHUB_API_VERSION: &str = "2022-11-28";

/// Validate a GitHub path segment (owner/repo/login) so it cannot alter the
/// request path or query. GitHub names only allow `[A-Za-z0-9._-]`, so anything
/// containing `/`, `?`, `#`, `..`, or other characters is rejected before it is
/// interpolated into an API path.
pub(crate) fn validate_path_segment(segment: &str) -> Result<(), AppError> {
    let valid = !segment.is_empty()
        && segment != ".."
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if valid {
        Ok(())
    } else {
        Err(AppError::GithubApi {
            status: 0,
            message: format!("Invalid GitHub identifier: {}", segment),
        })
    }
}

pub struct GitHubClient {
    http: reqwest::Client,
    base_url: String,
}

impl GitHubClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent("GitBaro/0.1.0")
            .build()
            .expect("Failed to create HTTP client");

        GitHubClient {
            http,
            base_url: GITHUB_API_BASE.to_string(),
        }
    }

    fn auth_headers(&self, token: &str) -> Result<reqwest::header::HeaderMap, AppError> {
        let mut headers = reqwest::header::HeaderMap::new();
        // 정적 문자열은 항상 유효하므로 unwrap 허용.
        headers.insert(
            reqwest::header::ACCEPT,
            "application/vnd.github+json".parse().unwrap(),
        );
        // 토큰은 외부(keychain) 입력이므로 개행 등 비가시 문자가 섞이면 파싱이
        // 실패할 수 있다. unwrap으로 앱 전체를 패닉시키지 않고 에러로 전파한다.
        let mut auth_value: reqwest::header::HeaderValue = format!("Bearer {}", token)
            .parse()
            .map_err(|_| AppError::GithubApi {
                status: 0,
                message: "Invalid authentication token format".to_string(),
            })?;
        auth_value.set_sensitive(true);
        headers.insert(reqwest::header::AUTHORIZATION, auth_value);
        headers.insert(
            "X-GitHub-Api-Version".parse::<reqwest::header::HeaderName>().unwrap(),
            GITHUB_API_VERSION.parse().unwrap(),
        );
        Ok(headers)
    }

    async fn get(&self, token: &str, path: &str) -> Result<Value, AppError> {
        let url = format!("{}{}", self.base_url, path);
        let response = self
            .http
            .get(&url)
            .headers(self.auth_headers(token)?)
            .send()
            .await?;

        self.handle_response(response).await
    }

    pub async fn get_with_query(
        &self,
        token: &str,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<Value, AppError> {
        let url = format!("{}{}", self.base_url, path);
        let response = self
            .http
            .get(&url)
            .headers(self.auth_headers(token)?)
            .query(query)
            .send()
            .await?;

        self.handle_response(response).await
    }

    async fn handle_response(&self, response: reqwest::Response) -> Result<Value, AppError> {
        let status = response.status();

        // Check for rate limit before reading body
        if status == reqwest::StatusCode::FORBIDDEN {
            let remaining = response
                .headers()
                .get("X-RateLimit-Remaining")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(1);

            if remaining == 0 {
                let reset_at = response
                    .headers()
                    .get("X-RateLimit-Reset")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("unknown")
                    .to_string();
                return Err(AppError::RateLimit { reset_at });
            }
        }

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

        let body: Value = response.json().await?;
        Ok(body)
    }

    pub async fn patch_empty(&self, token: &str, path: &str) -> Result<(), AppError> {
        let url = format!("{}{}", self.base_url, path);
        let response = self
            .http
            .patch(&url)
            .headers(self.auth_headers(token)?)
            .header("Content-Length", "0")
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() && status.as_u16() != 205 {
            return Err(AppError::GithubApi {
                status: status.as_u16(),
                message: "Request failed".to_string(),
            });
        }
        Ok(())
    }

    pub async fn get_user(&self, token: &str) -> Result<Value, AppError> {
        self.get(token, "/user").await
    }

    pub async fn get_user_by_login(&self, token: &str, login: &str) -> Result<Value, AppError> {
        validate_path_segment(login)?;
        let path = format!("/users/{}", login);
        self.get(token, &path).await
    }

    pub async fn get_user_emails(&self, token: &str) -> Result<Vec<Value>, AppError> {
        let body = self.get(token, "/user/emails").await?;
        Ok(body.as_array().cloned().unwrap_or_default())
    }

    pub async fn list_repos(&self, token: &str, page: u32) -> Result<Vec<Value>, AppError> {
        let page_str = page.to_string();
        let body = self
            .get_with_query(
                token,
                "/user/repos",
                &[
                    ("per_page", "100"),
                    ("page", &page_str),
                    ("sort", "updated"),
                ],
            )
            .await?;
        Ok(body.as_array().cloned().unwrap_or_default())
    }

    pub async fn get_repo(
        &self,
        token: &str,
        owner: &str,
        repo: &str,
    ) -> Result<Value, AppError> {
        validate_path_segment(owner)?;
        validate_path_segment(repo)?;
        let path = format!("/repos/{}/{}", owner, repo);
        self.get(token, &path).await
    }

    /// Fetch commit author avatars from `/repos/{owner}/{repo}/commits`.
    /// Returns a map of lowercase email → avatar_url.
    pub async fn get_commit_author_avatars(
        &self,
        token: &str,
        owner: &str,
        repo: &str,
    ) -> Result<HashMap<String, String>, AppError> {
        validate_path_segment(owner)?;
        validate_path_segment(repo)?;
        let path = format!("/repos/{}/{}/commits", owner, repo);
        let body = self
            .get_with_query(token, &path, &[("per_page", "100")])
            .await?;

        let mut map = HashMap::new();
        if let Some(commits) = body.as_array() {
            for item in commits {
                let email = item["commit"]["author"]["email"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase();
                let avatar_url = item["author"]["avatar_url"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();

                if !email.is_empty() && !avatar_url.is_empty() && !map.contains_key(&email) {
                    map.insert(email, avatar_url);
                }
            }
        }

        Ok(map)
    }
}

impl Default for GitHubClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_github_identifiers() {
        assert!(validate_path_segment("octocat").is_ok());
        assert!(validate_path_segment("my-repo.js").is_ok());
        assert!(validate_path_segment("under_score").is_ok());
    }

    #[test]
    fn rejects_path_altering_identifiers() {
        assert!(validate_path_segment("").is_err());
        assert!(validate_path_segment("..").is_err());
        assert!(validate_path_segment("owner/repo").is_err());
        assert!(validate_path_segment("repo?query").is_err());
        assert!(validate_path_segment("repo#frag").is_err());
        assert!(validate_path_segment("../../etc").is_err());
    }
}
