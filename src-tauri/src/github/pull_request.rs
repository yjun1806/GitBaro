//! Pull request 조회(읽기 전용). 목록과 상세는 GraphQL 한 번씩, 바뀐 파일은 REST 로 읽는다.
//!
//! - 목록: 리뷰 결정·CI 상태·코멘트 수까지 GraphQL 한 번에 받는다. REST 로 하면 PR 마다
//!   리뷰·상태 조회가 따로 나가야 한다.
//! - 상세: 본문·리뷰어·커밋·체크·대화·리뷰 스레드(해결 여부 포함)를 GraphQL 한 번에 받는다.
//!   REST 에는 스레드의 해결 여부가 없다.
//! - 바뀐 파일: GraphQL 에는 patch 가 없어서 REST `pulls/{n}/files` 를 쪽마다 조건부 요청으로 읽는다.
//!
//! 응답을 화면용 모양으로 바꾸는 일은 `pr_parse.rs` 가 한다.

use crate::error::AppError;
use crate::github::client::{validate_path_segment, GitHubClient};
use serde_json::{json, Value};

/// 목록에 싣는 PR 수. 최근에 고친 순서다.
const LIST_SIZE: u32 = 50;
/// 바뀐 파일을 읽는 쪽 수(쪽마다 100개). GitHub 은 3000개까지 주지만 그만큼은 화면에서 못 본다.
const MAX_FILE_PAGES: u32 = 10;
const FILES_PER_PAGE: usize = 100;

/// 목록에 보일 PR 상태.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrStateFilter {
    Open,
    Closed,
    All,
}

impl PrStateFilter {
    pub fn parse(value: &str) -> Self {
        match value {
            "closed" => Self::Closed,
            "all" => Self::All,
            _ => Self::Open,
        }
    }

    /// GraphQL `states` 인자. 닫힌 목록에는 병합한 PR 도 넣는다(GitHub 웹의 Closed 와 같다).
    fn states(self) -> Value {
        match self {
            Self::Open => json!(["OPEN"]),
            Self::Closed => json!(["CLOSED", "MERGED"]),
            Self::All => Value::Null,
        }
    }
}

const LIST_QUERY: &str = r#"
query($owner: String!, $name: String!, $states: [PullRequestState!], $first: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: $first, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number title url state isDraft createdAt updatedAt
        author { login avatarUrl }
        headRefName baseRefName headRefOid isCrossRepository
        headRepository { nameWithOwner }
        reviewDecision
        comments { totalCount }
        reviewThreads { totalCount }
        labels(first: 10) { nodes { name color } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}"#;

const DETAIL_QUERY: &str = r#"
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title url state isDraft createdAt updatedAt mergedAt closedAt body
      author { login avatarUrl }
      headRefName baseRefName headRefOid baseRefOid isCrossRepository
      headRepository { nameWithOwner }
      reviewDecision mergeable additions deletions changedFiles
      labels(first: 20) { nodes { name color } }
      reviewRequests(first: 20) {
        nodes { requestedReviewer {
          __typename
          ... on User { login avatarUrl }
          ... on Bot { login avatarUrl }
          ... on Team { name }
        } }
      }
      latestReviews(first: 30) { nodes { author { login avatarUrl } state submittedAt } }
      commits(first: 100) {
        totalCount
        nodes { commit { oid messageHeadline authoredDate author { name user { login avatarUrl } } } }
      }
      comments(first: 100) {
        totalCount
        nodes { id author { login avatarUrl } body createdAt url }
      }
      reviews(first: 100) {
        totalCount
        nodes { id author { login avatarUrl } state body submittedAt url }
      }
      reviewThreads(first: 100) {
        totalCount
        nodes {
          id isResolved isOutdated path line originalLine startLine diffSide
          comments(first: 50) {
            totalCount
            nodes { id author { login avatarUrl } body createdAt url diffHunk }
          }
        }
      }
      statusRollup: commits(last: 1) {
        nodes { commit { statusCheckRollup {
          state
          contexts(first: 100) {
            totalCount
            nodes {
              __typename
              ... on CheckRun { name status conclusion detailsUrl }
              ... on StatusContext { context state targetUrl description }
            }
          }
        } } }
      }
    }
  }
}"#;

/// 저장소의 PR 목록(GraphQL `data`).
pub async fn list_pull_requests(
    client: &GitHubClient,
    token: &str,
    owner: &str,
    repo: &str,
    state: PrStateFilter,
    force: bool,
) -> Result<Value, AppError> {
    validate_path_segment(owner)?;
    validate_path_segment(repo)?;
    let variables = json!({ "owner": owner, "name": repo, "states": state.states(), "first": LIST_SIZE });
    client.graphql(token, LIST_QUERY, variables, force).await
}

/// PR 하나의 상세(GraphQL `data`).
pub async fn get_pull_request(
    client: &GitHubClient,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    force: bool,
) -> Result<Value, AppError> {
    validate_path_segment(owner)?;
    validate_path_segment(repo)?;
    let variables = json!({ "owner": owner, "name": repo, "number": number });
    client.graphql(token, DETAIL_QUERY, variables, force).await
}

/// PR 의 바뀐 파일(REST 원본 배열)과 잘렸는지. 쪽마다 조건부 요청이라 다시 읽어도 한도를 거의 쓰지 않는다.
pub async fn list_pull_request_files(
    client: &GitHubClient,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<(Vec<Value>, bool), AppError> {
    validate_path_segment(owner)?;
    validate_path_segment(repo)?;
    let path = format!("/repos/{}/{}/pulls/{}/files", owner, repo, number);
    let per_page = FILES_PER_PAGE.to_string();
    let mut files = Vec::new();
    for page in 1..=MAX_FILE_PAGES {
        let page_str = page.to_string();
        let body = client
            .get_conditional(token, &path, &[("per_page", &per_page), ("page", &page_str)])
            .await?;
        let items = body.as_array().cloned().unwrap_or_default();
        let full = items.len() == FILES_PER_PAGE;
        files.extend(items);
        if !full {
            return Ok((files, false));
        }
    }
    Ok((files, true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_filter_maps_to_graphql_states() {
        assert_eq!(PrStateFilter::parse("open").states(), json!(["OPEN"]));
        assert_eq!(PrStateFilter::parse("closed").states(), json!(["CLOSED", "MERGED"]));
        assert_eq!(PrStateFilter::parse("all").states(), Value::Null);
        // 모르는 값은 열린 PR 로 본다.
        assert_eq!(PrStateFilter::parse("bogus"), PrStateFilter::Open);
    }
}
