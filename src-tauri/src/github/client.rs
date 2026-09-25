use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use crate::error::AppError;
use crate::github::cache;
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

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// The process-wide HTTP client for GitHub REST calls (cheap to clone).
fn shared_http_client() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent("GitBaro/0.1.0")
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(REQUEST_TIMEOUT)
                .build()
                .unwrap_or_else(|e| {
                    tracing::error!("Failed to build GitHub HTTP client: {}", e);
                    reqwest::Client::new()
                })
        })
        .clone()
}

/// True for an HTTP 401 from the GitHub API — the token was revoked or rotated.
pub(crate) fn is_unauthorized(err: &AppError) -> bool {
    matches!(err, AppError::GithubApi { status: 401, .. })
}

pub struct GitHubClient {
    http: reqwest::Client,
    base_url: String,
}

impl GitHubClient {
    /// All instances share one connection pool with connect/total timeouts, so
    /// a stalled network surfaces as an error instead of hanging the UI.
    pub fn new() -> Self {
        GitHubClient {
            http: shared_http_client(),
            base_url: GITHUB_API_BASE.to_string(),
        }
    }

    /// A client aimed at a local test server instead of api.github.com.
    #[cfg(test)]
    pub(crate) fn with_base_url(base_url: &str) -> Self {
        GitHubClient {
            http: shared_http_client(),
            base_url: base_url.to_string(),
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

    /// GET with `If-None-Match`: a 304 reuses the body cached for the same
    /// token and URL, and does not count against the hourly rate limit.
    pub async fn get_conditional(
        &self,
        token: &str,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<Value, AppError> {
        let url = format!("{}{}", self.base_url, path);
        let query_text: Vec<String> = query.iter().map(|(k, v)| format!("{k}={v}")).collect();
        let key = cache::cache_key(token, &format!("GET {}?{}", path, query_text.join("&")));
        let cached = cache::etag_for(&key);

        let mut request = self
            .http
            .get(&url)
            .headers(self.auth_headers(token)?)
            .query(query);
        if let Some((etag, _)) = &cached {
            request = request.header(reqwest::header::IF_NONE_MATCH, etag.as_str());
        }
        let response = request.send().await?;

        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            if let Some((_, body)) = cached {
                return Ok(body);
            }
        }
        let etag = response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let body = self.handle_response(response).await?;
        cache::put(key, etag, &body);
        Ok(body)
    }

    /// POST a GraphQL query. Answers are reused for `cache::GRAPHQL_TTL`
    /// unless `force` is set. GraphQL reports most failures inside a 200
    /// response, so `errors` are mapped onto the REST-style `AppError`s the
    /// rest of the app already handles (404 no access, rate limit).
    pub async fn graphql(
        &self,
        token: &str,
        query: &str,
        variables: Value,
        force: bool,
    ) -> Result<Value, AppError> {
        let key = cache::cache_key(token, &format!("POST /graphql {} {}", query, variables));
        if !force {
            if let Some(body) = cache::fresh(&key, cache::GRAPHQL_TTL) {
                return Ok(body);
            }
        }
        let url = format!("{}/graphql", self.base_url);
        let response = self
            .http
            .post(&url)
            .headers(self.auth_headers(token)?)
            .json(&serde_json::json!({ "query": query, "variables": variables }))
            .send()
            .await?;
        let reset_at = response
            .headers()
            .get("X-RateLimit-Reset")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let body = self.handle_response(response).await?;
        graphql_error(&body, reset_at.as_deref())?;
        let data = body["data"].clone();
        cache::put(key, None, &data);
        Ok(data)
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

/// The first GraphQL error as an `AppError`, or Ok when the answer has none.
/// A partial answer (data plus errors) is used as is: typed `NOT_FOUND`/`FORBIDDEN`
/// errors fail the call only when `data` or `data.repository` is null (the
/// repository itself could not be read), not when one nested field could not.
/// `reset_at` is the `X-RateLimit-Reset` header, kept for `RATE_LIMITED`.
pub(crate) fn graphql_error(body: &Value, reset_at: Option<&str>) -> Result<(), AppError> {
    let Some(first) = body["errors"].as_array().and_then(|e| e.first()) else {
        return Ok(());
    };
    let message = first["message"].as_str().unwrap_or("GitHub GraphQL error").to_string();
    let data = &body["data"];
    let unreadable = data.is_null() || data.get("repository").is_some_and(Value::is_null);
    match first["type"].as_str() {
        Some("RATE_LIMITED") => Err(AppError::RateLimit {
            reset_at: reset_at.unwrap_or("unknown").to_string(),
        }),
        Some("NOT_FOUND") if unreadable => Err(AppError::GithubApi { status: 404, message }),
        Some("FORBIDDEN") if unreadable => Err(AppError::GithubApi { status: 403, message }),
        _ if data.is_null() => Err(AppError::GithubApi { status: 0, message }),
        _ => Ok(()),
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

    #[test]
    fn graphql_errors_map_to_app_errors() {
        use serde_json::json;
        assert!(graphql_error(&json!({"data": {"x": 1}}), None).is_ok());
        let not_found = json!({"data": {"repository": null}, "errors": [{"type": "NOT_FOUND", "message": "no"}]});
        assert!(matches!(graphql_error(&not_found, None), Err(AppError::GithubApi { status: 404, .. })));
        let limited = json!({"data": null, "errors": [{"type": "RATE_LIMITED", "message": "slow"}]});
        assert!(matches!(graphql_error(&limited, None), Err(AppError::RateLimit { .. })));
        let other = json!({"data": null, "errors": [{"message": "bad query"}]});
        assert!(matches!(graphql_error(&other, None), Err(AppError::GithubApi { status: 0, .. })));
        // 일부만 실패한 답은 쓸 수 있는 데이터가 있으면 그대로 쓴다.
        let partial = json!({"data": {"x": 1}, "errors": [{"type": "SOMETHING", "message": "m"}]});
        assert!(graphql_error(&partial, None).is_ok());
    }

    #[test]
    fn typed_errors_on_part_of_an_answer_keep_the_data() {
        use serde_json::json;
        // 저장소는 읽었고 그 안의 한 필드(예: 지운 사용자의 리뷰)만 NOT_FOUND·FORBIDDEN 이다.
        let nested = json!({
            "data": {"repository": {"pullRequest": {"number": 1}}},
            "errors": [{"type": "FORBIDDEN", "message": "no access to one reviewer", "path": ["repository", "pullRequest", "reviews"]}]
        });
        assert!(graphql_error(&nested, None).is_ok());
        let missing = json!({"data": {"repository": {"x": 1}}, "errors": [{"type": "NOT_FOUND", "message": "gone"}]});
        assert!(graphql_error(&missing, None).is_ok());
        let no_data = json!({"data": null, "errors": [{"type": "FORBIDDEN", "message": "no"}]});
        assert!(matches!(graphql_error(&no_data, None), Err(AppError::GithubApi { status: 403, .. })));
    }

    #[test]
    fn a_rate_limited_answer_keeps_the_reset_time() {
        use serde_json::json;
        let limited = json!({"data": null, "errors": [{"type": "RATE_LIMITED", "message": "slow"}]});
        match graphql_error(&limited, Some("1790000000")) {
            Err(AppError::RateLimit { reset_at }) => assert_eq!(reset_at, "1790000000"),
            other => panic!("{other:?}"),
        }
    }
}
