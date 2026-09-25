use crate::error::AppError;
use crate::github::client::GitHubClient;
use serde_json::Value;

/// 실행 목록 한 쪽. `If-None-Match` 조건부 요청이다(`GitHubClient::get_conditional`).
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
    // CI 실패 알림이 저장소마다 주기적으로 읽는다. 바뀌지 않았으면 304 로 끝나 요청 한도를 쓰지 않는다.
    client
        .get_conditional(token, &path, &[("per_page", "30"), ("page", &page_str)])
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Serves `/actions/runs`: 200 with an ETag, then 304 to any request that sends it back.
    /// Returns the base URL and, per request, whether it carried `If-None-Match`.
    async fn etag_server() -> (String, tokio::sync::mpsc::UnboundedReceiver<bool>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else { return };
                let tx = tx.clone();
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 4096];
                    loop {
                        let Ok(n) = stream.read(&mut chunk).await else { return };
                        if n == 0 {
                            return;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                        while let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            let head = String::from_utf8_lossy(&buf[..end]).to_ascii_lowercase();
                            buf.drain(..end + 4);
                            let conditional = head.contains("if-none-match: \"runs-v1\"");
                            let _ = tx.send(conditional);
                            let response = if conditional {
                                "HTTP/1.1 304 Not Modified\r\netag: \"runs-v1\"\r\ncontent-length: 0\r\n\r\n".to_string()
                            } else {
                                let body = r#"{"total_count":1,"workflow_runs":[{"id":7}]}"#;
                                format!(
                                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\netag: \"runs-v1\"\r\ncontent-length: {}\r\n\r\n{}",
                                    body.len(),
                                    body
                                )
                            };
                            if stream.write_all(response.as_bytes()).await.is_err() {
                                return;
                            }
                        }
                    }
                });
            }
        });
        (format!("http://{addr}"), rx)
    }

    #[tokio::test]
    async fn polling_the_runs_list_sends_the_etag_and_reuses_the_body_on_304() {
        // CI 실패 알림이 저장소마다 이 목록을 주기적으로 읽는다. 304는 GitHub 요청 한도에서 빠진다.
        let (base, mut seen) = etag_server().await;
        let client = GitHubClient::with_base_url(&base);
        let token = "etag-test-token";

        let first = list_workflow_runs(&client, token, "acme", "app", 1).await.unwrap();
        let second = list_workflow_runs(&client, token, "acme", "app", 1).await.unwrap();

        assert_eq!(seen.recv().await, Some(false));
        assert_eq!(seen.recv().await, Some(true));
        assert_eq!(first, second);
        assert_eq!(second["workflow_runs"][0]["id"], 7);
    }
}
