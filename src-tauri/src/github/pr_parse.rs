//! GitHub PR 응답(GraphQL `data`, REST 파일 배열)을 화면용 모양으로 바꾼다.
//!
//! 값이 빠지거나 null 이어도(지운 계정, 지운 포크, 권한 없는 체크) 실패하지 않고 빈 값으로 채운다.
//! 목록 하나가 이상하다고 PR 화면 전체를 못 보게 하지 않는다.

use crate::git::file_diff::{PatchHunk, PatchLine};
use crate::error::AppError;
use serde::Serialize;
use serde_json::Value;

// ─── Types ───

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrUser {
    pub login: String,
    pub avatar_url: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrLabel {
    pub name: String,
    /// 16진 색(`#` 없이). GitHub 이 주는 그대로다.
    pub color: String,
}

/// 목록 한 줄.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSummary {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// `open` | `closed` | `merged`
    pub state: String,
    pub is_draft: bool,
    pub author: PrUser,
    pub head_ref: String,
    pub base_ref: String,
    pub head_sha: String,
    /// 포크에서 온 PR. 이 저장소의 원격에는 head 브랜치가 없다.
    pub is_cross_repository: bool,
    /// head 가 있는 저장소(`owner/name`). 포크를 지웠으면 없다.
    pub head_repo: Option<String>,
    /// `approved` | `changes_requested` | `review_required`. 리뷰 규칙이 없으면 없다.
    pub review_decision: Option<String>,
    /// 마지막 커밋의 CI 종합: `success` | `failure` | `error` | `pending` | `expected`. 체크가 없으면 없다.
    pub ci_state: Option<String>,
    /// 대화 코멘트 수(리뷰 스레드는 `thread_count`).
    pub comment_count: u64,
    pub thread_count: u64,
    pub labels: Vec<PrLabel>,
    pub created_at: String,
    pub updated_at: String,
}

/// 리뷰어 한 명과 그 상태.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrReviewer {
    pub login: String,
    pub avatar_url: Option<String>,
    /// `approved` | `changes_requested` | `commented` | `dismissed` | `pending` | `requested`
    pub state: String,
    pub is_team: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrCommit {
    pub oid: String,
    pub headline: String,
    pub author_name: String,
    pub author: Option<PrUser>,
    pub authored_at: String,
}

/// 체크 하나. GitHub Actions 등의 check run 과 옛 commit status 를 한 모양으로 둔다.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrCheck {
    pub name: String,
    /// `completed` | `in_progress` | `queued` | `pending` 등(소문자).
    pub status: String,
    /// 끝난 체크의 결과(소문자). `success` | `failure` | `neutral` | `cancelled` | `skipped` | `timed_out` ...
    pub conclusion: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
}

/// 대화 칸의 한 항목. 대화 코멘트이거나, 본문이나 판정이 있는 리뷰다.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrConversationItem {
    /// `comment` | `review`
    pub kind: String,
    pub id: String,
    pub author: PrUser,
    pub body: String,
    pub created_at: String,
    pub url: String,
    /// 리뷰일 때 판정(`approved` | `changes_requested` | `commented` | `dismissed`).
    pub review_state: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrThreadComment {
    pub id: String,
    pub author: PrUser,
    pub body: String,
    pub created_at: String,
    pub url: String,
}

/// 코드 줄에 단 리뷰 스레드.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrReviewThread {
    pub id: String,
    pub path: String,
    /// 지금 diff 에서의 줄 번호(`side` 쪽). 코드가 바뀌어 자리를 잃었으면(outdated) 없다.
    pub line: Option<u32>,
    /// 코멘트를 달 때의 줄 번호.
    pub original_line: Option<u32>,
    /// 여러 줄에 단 코멘트의 첫 줄.
    pub start_line: Option<u32>,
    /// `left`(지운 쪽, 옛 줄 번호) | `right`(새 쪽, 새 줄 번호)
    pub side: String,
    pub is_resolved: bool,
    pub is_outdated: bool,
    /// 첫 코멘트가 가리키는 diff 조각. 자리를 잃은 스레드도 이것으로 어디였는지 보인다.
    pub diff_hunk: String,
    pub comments: Vec<PrThreadComment>,
    /// 스레드의 코멘트가 50개를 넘어 일부만 실었다.
    pub comments_truncated: bool,
}

/// 한 번에 다 싣지 못한 목록. 화면이 「GitHub 에서 더 보기」를 띄운다.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrTruncation {
    pub commits: bool,
    pub comments: bool,
    pub reviews: bool,
    pub threads: bool,
    pub checks: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetail {
    #[serde(flatten)]
    pub summary: PullRequestSummary,
    pub body: String,
    pub base_sha: String,
    pub merged_at: Option<String>,
    pub closed_at: Option<String>,
    /// `mergeable` | `conflicting` | `unknown`
    pub mergeable: String,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub reviewers: Vec<PrReviewer>,
    pub commits: Vec<PrCommit>,
    pub commit_count: u64,
    pub checks: Vec<PrCheck>,
    pub conversation: Vec<PrConversationItem>,
    pub threads: Vec<PrReviewThread>,
    pub truncated: PrTruncation,
    /// base 와 head 커밋이 로컬 저장소에 다 있어 diff 를 로컬에서 만들 수 있다.
    /// 명령이 채운다(파싱 단계에서는 늘 false).
    pub local_diff: bool,
}

/// 바뀐 파일 하나.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrFile {
    pub path: String,
    /// 이름을 바꾼 파일의 이전 경로.
    pub old_path: Option<String>,
    /// `added` | `removed` | `modified` | `renamed` | `copied` | `changed` | `unchanged`
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    /// GitHub 이 준 patch 를 나눈 구간. 바이너리이거나 너무 커서 patch 가 없으면 없다.
    pub hunks: Option<Vec<PatchHunk>>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrFiles {
    pub files: Vec<PrFile>,
    /// 1000개까지만 읽었다.
    pub truncated: bool,
}

// ─── Helpers ───

fn text(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string()
}

fn opt_text(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

fn lower(v: &Value) -> Option<String> {
    v.as_str().map(|s| s.to_ascii_lowercase())
}

fn nodes(v: &Value) -> &[Value] {
    v["nodes"].as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn line_no(v: &Value) -> Option<u32> {
    v.as_u64().and_then(|n| u32::try_from(n).ok())
}

/// 지운 계정은 GraphQL 이 `author: null` 로 준다. GitHub 웹처럼 `ghost` 로 보인다.
fn user(v: &Value) -> PrUser {
    PrUser {
        login: v["login"].as_str().unwrap_or("ghost").to_string(),
        avatar_url: opt_text(&v["avatarUrl"]),
    }
}

/// 전체 개수가 실은 개수보다 크면 잘린 것이다.
fn is_truncated(conn: &Value) -> bool {
    conn["totalCount"].as_u64().unwrap_or(0) > nodes(conn).len() as u64
}

fn labels(v: &Value) -> Vec<PrLabel> {
    nodes(v)
        .iter()
        .map(|l| PrLabel {
            name: text(&l["name"]),
            color: text(&l["color"]),
        })
        .collect()
}

fn summary(pr: &Value) -> PullRequestSummary {
    let rollup = nodes(&pr["commits"])
        .last()
        .map(|c| &c["commit"]["statusCheckRollup"]["state"])
        .and_then(lower);
    PullRequestSummary {
        number: pr["number"].as_u64().unwrap_or(0),
        title: text(&pr["title"]),
        url: text(&pr["url"]),
        state: lower(&pr["state"]).unwrap_or_else(|| "open".to_string()),
        is_draft: pr["isDraft"].as_bool().unwrap_or(false),
        author: user(&pr["author"]),
        head_ref: text(&pr["headRefName"]),
        base_ref: text(&pr["baseRefName"]),
        head_sha: text(&pr["headRefOid"]),
        is_cross_repository: pr["isCrossRepository"].as_bool().unwrap_or(false),
        head_repo: opt_text(&pr["headRepository"]["nameWithOwner"]),
        review_decision: lower(&pr["reviewDecision"]),
        ci_state: rollup,
        comment_count: pr["comments"]["totalCount"].as_u64().unwrap_or(0),
        thread_count: pr["reviewThreads"]["totalCount"].as_u64().unwrap_or(0),
        labels: labels(&pr["labels"]),
        created_at: text(&pr["createdAt"]),
        updated_at: text(&pr["updatedAt"]),
    }
}

// ─── List ───

/// GraphQL 목록 답 → 목록 줄. 저장소가 없으면(권한 없음) `graphql_error` 가 이미 404 로 막는다.
pub fn parse_pr_list(data: &Value) -> Vec<PullRequestSummary> {
    nodes(&data["repository"]["pullRequests"])
        .iter()
        .filter(|pr| pr["number"].is_u64())
        .map(summary)
        .collect()
}

// ─── Detail ───

/// 리뷰어 목록: 마지막 리뷰의 판정에 리뷰 요청을 더한다. 다시 요청받은 사람은 `requested` 로 보인다
/// (지금 그 사람의 리뷰를 기다리는 중이다).
fn reviewers(pr: &Value) -> Vec<PrReviewer> {
    let mut out: Vec<PrReviewer> = nodes(&pr["latestReviews"])
        .iter()
        .filter(|r| r["state"].as_str() != Some("PENDING"))
        .map(|r| {
            let who = user(&r["author"]);
            PrReviewer {
                login: who.login,
                avatar_url: who.avatar_url,
                state: lower(&r["state"]).unwrap_or_else(|| "commented".to_string()),
                is_team: false,
            }
        })
        .collect();
    for req in nodes(&pr["reviewRequests"]) {
        let r = &req["requestedReviewer"];
        let is_team = r["__typename"].as_str() == Some("Team");
        let login = if is_team { text(&r["name"]) } else { text(&r["login"]) };
        if login.is_empty() {
            continue;
        }
        match out.iter_mut().find(|x| x.login == login && x.is_team == is_team) {
            Some(existing) => existing.state = "requested".to_string(),
            None => out.push(PrReviewer {
                login,
                avatar_url: opt_text(&r["avatarUrl"]),
                state: "requested".to_string(),
                is_team,
            }),
        }
    }
    out
}

fn commits(pr: &Value) -> Vec<PrCommit> {
    nodes(&pr["commits"])
        .iter()
        .map(|n| {
            let c = &n["commit"];
            let gh_user = &c["author"]["user"];
            PrCommit {
                oid: text(&c["oid"]),
                headline: text(&c["messageHeadline"]),
                author_name: text(&c["author"]["name"]),
                author: gh_user.is_object().then(|| user(gh_user)),
                authored_at: text(&c["authoredDate"]),
            }
        })
        .collect()
}

/// check run 과 commit status 를 한 모양으로. status 의 `error` 는 결과 `failure` 로 본다.
fn check(node: &Value) -> Option<PrCheck> {
    match node["__typename"].as_str()? {
        "CheckRun" => Some(PrCheck {
            name: text(&node["name"]),
            status: lower(&node["status"]).unwrap_or_else(|| "queued".to_string()),
            conclusion: lower(&node["conclusion"]),
            url: opt_text(&node["detailsUrl"]),
            description: None,
        }),
        "StatusContext" => {
            let state = lower(&node["state"]).unwrap_or_default();
            let (status, conclusion) = match state.as_str() {
                "pending" | "expected" => ("pending", None),
                "success" => ("completed", Some("success")),
                _ => ("completed", Some("failure")),
            };
            Some(PrCheck {
                name: text(&node["context"]),
                status: status.to_string(),
                conclusion: conclusion.map(str::to_string),
                url: opt_text(&node["targetUrl"]),
                description: opt_text(&node["description"]),
            })
        }
        _ => None,
    }
}

fn check_contexts(pr: &Value) -> &Value {
    nodes(&pr["statusRollup"])
        .last()
        .map(|c| &c["commit"]["statusCheckRollup"]["contexts"])
        .unwrap_or(&Value::Null)
}

/// 대화: 대화 코멘트와 리뷰를 시간순으로 섞는다. 본문 없는 `COMMENTED` 리뷰는 줄 코멘트를 담는
/// 껍데기일 뿐이라 뺀다. 본문이 없어도 승인·변경 요청·기각은 대화에 남긴다. 작성 중(PENDING)은 뺀다.
pub fn conversation(pr: &Value) -> Vec<PrConversationItem> {
    let comments = nodes(&pr["comments"]).iter().map(|c| PrConversationItem {
        kind: "comment".to_string(),
        id: text(&c["id"]),
        author: user(&c["author"]),
        body: text(&c["body"]),
        created_at: text(&c["createdAt"]),
        url: text(&c["url"]),
        review_state: None,
    });
    let reviews = nodes(&pr["reviews"]).iter().filter_map(|r| {
        let state = r["state"].as_str().unwrap_or("");
        let body = text(&r["body"]);
        let keep = match state {
            "PENDING" => false,
            "COMMENTED" => !body.trim().is_empty(),
            _ => true,
        };
        keep.then(|| PrConversationItem {
            kind: "review".to_string(),
            id: text(&r["id"]),
            author: user(&r["author"]),
            body,
            created_at: text(&r["submittedAt"]),
            url: text(&r["url"]),
            review_state: Some(state.to_ascii_lowercase()),
        })
    });
    let mut items: Vec<PrConversationItem> = comments.chain(reviews).collect();
    // ISO 8601(UTC, 같은 자릿수)이라 글자 순서가 시간 순서다. 같은 시각이면 들어온 순서를 지킨다.
    items.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    items
}

pub fn threads(pr: &Value) -> Vec<PrReviewThread> {
    nodes(&pr["reviewThreads"])
        .iter()
        .map(|t| {
            let comments_conn = &t["comments"];
            let first = nodes(comments_conn).first();
            PrReviewThread {
                id: text(&t["id"]),
                path: text(&t["path"]),
                line: line_no(&t["line"]),
                original_line: line_no(&t["originalLine"]),
                start_line: line_no(&t["startLine"]),
                side: if t["diffSide"].as_str() == Some("LEFT") { "left" } else { "right" }.to_string(),
                is_resolved: t["isResolved"].as_bool().unwrap_or(false),
                is_outdated: t["isOutdated"].as_bool().unwrap_or(false),
                diff_hunk: first.map(|c| text(&c["diffHunk"])).unwrap_or_default(),
                comments: nodes(comments_conn)
                    .iter()
                    .map(|c| PrThreadComment {
                        id: text(&c["id"]),
                        author: user(&c["author"]),
                        body: text(&c["body"]),
                        created_at: text(&c["createdAt"]),
                        url: text(&c["url"]),
                    })
                    .collect(),
                comments_truncated: is_truncated(comments_conn),
            }
        })
        .collect()
}

/// GraphQL 상세 답 → 상세. PR 이 없으면 404.
pub fn parse_pr_detail(data: &Value) -> Result<PullRequestDetail, AppError> {
    let pr = &data["repository"]["pullRequest"];
    if !pr.is_object() {
        return Err(AppError::GithubApi {
            status: 404,
            message: "Pull request not found".to_string(),
        });
    }
    let contexts = check_contexts(pr);
    Ok(PullRequestDetail {
        summary: PullRequestSummary {
            ci_state: nodes(&pr["statusRollup"])
                .last()
                .and_then(|c| lower(&c["commit"]["statusCheckRollup"]["state"])),
            ..summary(pr)
        },
        body: text(&pr["body"]),
        base_sha: text(&pr["baseRefOid"]),
        merged_at: opt_text(&pr["mergedAt"]),
        closed_at: opt_text(&pr["closedAt"]),
        mergeable: lower(&pr["mergeable"]).unwrap_or_else(|| "unknown".to_string()),
        additions: pr["additions"].as_u64().unwrap_or(0),
        deletions: pr["deletions"].as_u64().unwrap_or(0),
        changed_files: pr["changedFiles"].as_u64().unwrap_or(0),
        reviewers: reviewers(pr),
        commits: commits(pr),
        commit_count: pr["commits"]["totalCount"].as_u64().unwrap_or(0),
        checks: nodes(contexts).iter().filter_map(check).collect(),
        conversation: conversation(pr),
        threads: threads(pr),
        truncated: PrTruncation {
            commits: is_truncated(&pr["commits"]),
            comments: is_truncated(&pr["comments"]),
            reviews: is_truncated(&pr["reviews"]),
            threads: is_truncated(&pr["reviewThreads"]),
            checks: is_truncated(contexts),
        },
        local_diff: false,
    })
}

// ─── Files ───

/// `@@ -a,b +c,d @@ 뒤 글` 머리에서 시작 줄 둘.
fn hunk_starts(header: &str) -> Option<(u32, u32)> {
    let rest = header.strip_prefix("@@ -")?;
    let (old, rest) = rest.split_once(" +")?;
    let (new, _) = rest.split_once(" @@")?;
    let start = |range: &str| range.split(',').next()?.parse::<u32>().ok();
    Some((start(old)?, start(new)?))
}

/// GitHub `patch`(머리 `---`/`+++` 없이 `@@` 구간만 있는 unified diff)를 구간으로 나눈다.
/// 줄 내용 끝에는 git2 diff 처럼 줄바꿈을 붙인다. `\ No newline at end of file` 은 뺀다.
/// 머리를 못 읽는 구간이 있으면 None — 틀린 줄 번호로 코멘트 자리를 가리키느니 patch 를 안 보인다.
pub fn parse_patch(patch: &str) -> Option<Vec<PatchHunk>> {
    let mut hunks: Vec<PatchHunk> = Vec::new();
    let (mut old_no, mut new_no) = (0u32, 0u32);
    for raw in patch.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if line.starts_with("@@") {
            let (old_start, new_start) = hunk_starts(line)?;
            old_no = old_start;
            new_no = new_start;
            hunks.push(PatchHunk {
                header: format!("{line}\n"),
                old_start,
                new_start,
                lines: Vec::new(),
            });
            continue;
        }
        let Some(hunk) = hunks.last_mut() else {
            continue;
        };
        let (kind, old_line_no, new_line_no) = match line.chars().next() {
            Some('+') => ("addition", None, Some(new_no)),
            Some('-') => ("deletion", Some(old_no), None),
            Some(' ') => ("context", Some(old_no), Some(new_no)),
            // `\ No newline at end of file`, 끝의 빈 줄
            _ => continue,
        };
        if old_line_no.is_some() {
            old_no += 1;
        }
        if new_line_no.is_some() {
            new_no += 1;
        }
        hunk.lines.push(PatchLine {
            kind,
            content: format!("{}\n", &line[1..]),
            old_line_no,
            new_line_no,
        });
    }
    Some(hunks)
}

pub fn parse_pr_files(items: &[Value], truncated: bool) -> PrFiles {
    let files = items
        .iter()
        .filter_map(|f| {
            let path = opt_text(&f["filename"])?;
            Some(PrFile {
                path,
                old_path: opt_text(&f["previous_filename"]),
                status: text(&f["status"]),
                additions: f["additions"].as_u64().unwrap_or(0),
                deletions: f["deletions"].as_u64().unwrap_or(0),
                hunks: f["patch"].as_str().and_then(parse_patch),
            })
        })
        .collect();
    PrFiles { files, truncated }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let text = match name {
            "list" => include_str!("fixtures/pr_list.json"),
            "detail" => include_str!("fixtures/pr_detail.json"),
            "files" => include_str!("fixtures/pr_files.json"),
            _ => unreachable!(),
        };
        serde_json::from_str(text).expect("fixture is valid JSON")
    }

    #[test]
    fn list_reads_chips_and_tolerates_missing_fields() {
        let list = parse_pr_list(&fixture("list"));
        assert_eq!(list.len(), 2);

        let first = &list[0];
        assert_eq!(first.number, 42);
        assert_eq!(first.state, "open");
        assert_eq!(first.author.login, "agent-bot");
        assert_eq!(first.head_ref, "feat/login");
        assert_eq!(first.base_ref, "main");
        assert_eq!(first.review_decision.as_deref(), Some("changes_requested"));
        assert_eq!(first.ci_state.as_deref(), Some("failure"));
        assert_eq!(first.comment_count, 3);
        assert_eq!(first.thread_count, 2);
        assert_eq!(first.labels, vec![PrLabel { name: "agent".into(), color: "0e8a16".into() }]);
        assert!(!first.is_cross_repository);

        // 지운 계정·지운 포크·체크 없음·리뷰 규칙 없음
        let second = &list[1];
        assert_eq!(second.author.login, "ghost");
        assert!(second.is_draft);
        assert!(second.is_cross_repository);
        assert_eq!(second.head_repo, None);
        assert_eq!(second.ci_state, None);
        assert_eq!(second.review_decision, None);
    }

    #[test]
    fn detail_merges_reviewers_and_requests() {
        let detail = parse_pr_detail(&fixture("detail")).unwrap();
        let states: Vec<(&str, &str, bool)> = detail
            .reviewers
            .iter()
            .map(|r| (r.login.as_str(), r.state.as_str(), r.is_team))
            .collect();
        assert_eq!(
            states,
            vec![
                ("alice", "changes_requested", false),
                // bob 은 승인했다가 다시 요청받았다.
                ("bob", "requested", false),
                ("core-team", "requested", true),
            ]
        );
    }

    #[test]
    fn detail_conversation_is_time_ordered_and_skips_carrier_reviews() {
        let detail = parse_pr_detail(&fixture("detail")).unwrap();
        let items: Vec<(&str, &str)> = detail
            .conversation
            .iter()
            .map(|c| (c.kind.as_str(), c.created_at.as_str()))
            .collect();
        assert_eq!(
            items,
            vec![
                ("comment", "2026-09-20T10:00:00Z"),
                ("review", "2026-09-20T11:00:00Z"),
                ("comment", "2026-09-21T09:00:00Z"),
                ("review", "2026-09-21T12:00:00Z"),
            ]
        );
        assert_eq!(detail.conversation[1].review_state.as_deref(), Some("approved"));
        assert_eq!(detail.conversation[3].review_state.as_deref(), Some("changes_requested"));
    }

    #[test]
    fn detail_threads_keep_anchor_side_and_outdated_state() {
        let detail = parse_pr_detail(&fixture("detail")).unwrap();
        assert_eq!(detail.threads.len(), 2);
        let live = &detail.threads[0];
        assert_eq!(live.path, "src/login.ts");
        assert_eq!(live.line, Some(12));
        assert_eq!(live.side, "right");
        assert!(!live.is_outdated);
        assert!(live.is_resolved);
        assert_eq!(live.comments.len(), 2);
        assert!(live.diff_hunk.starts_with("@@ -10,3 +10,4 @@"));

        let old = &detail.threads[1];
        assert_eq!(old.line, None);
        assert_eq!(old.original_line, Some(5));
        assert_eq!(old.side, "left");
        assert!(old.is_outdated);
        assert_eq!(old.comments[0].author.login, "ghost");
        assert!(old.comments_truncated);
    }

    #[test]
    fn detail_checks_unify_check_runs_and_statuses() {
        let detail = parse_pr_detail(&fixture("detail")).unwrap();
        let checks: Vec<(&str, &str, Option<&str>)> = detail
            .checks
            .iter()
            .map(|c| (c.name.as_str(), c.status.as_str(), c.conclusion.as_deref()))
            .collect();
        assert_eq!(
            checks,
            vec![
                ("test", "completed", Some("failure")),
                ("lint", "in_progress", None),
                ("ci/legacy", "completed", Some("failure")),
                ("deploy/preview", "pending", None),
            ]
        );
        assert_eq!(detail.summary.ci_state.as_deref(), Some("failure"));
        assert_eq!(detail.mergeable, "conflicting");
        assert_eq!(detail.base_sha, "base000");
        assert_eq!(detail.commits.len(), 2);
        assert_eq!(detail.commits[1].author, None);
        assert_eq!(detail.commits[1].author_name, "Local Name");
        assert!(detail.truncated.commits);
        assert!(!detail.truncated.threads);
    }

    #[test]
    fn detail_without_pull_request_is_not_found() {
        let data = serde_json::json!({"repository": {"pullRequest": null}});
        assert!(matches!(parse_pr_detail(&data), Err(AppError::GithubApi { status: 404, .. })));
    }

    #[test]
    fn patch_lines_get_numbers_and_newlines() {
        let hunks = parse_patch("@@ -10,3 +10,4 @@ fn main\n a\n-b\n+c\n+d\n e\n\\ No newline at end of file").unwrap();
        assert_eq!(hunks.len(), 1);
        let h = &hunks[0];
        assert_eq!((h.old_start, h.new_start), (10, 10));
        assert_eq!(h.header, "@@ -10,3 +10,4 @@ fn main\n");
        let lines: Vec<(&str, Option<u32>, Option<u32>, &str)> = h
            .lines
            .iter()
            .map(|l| (l.kind, l.old_line_no, l.new_line_no, l.content.as_str()))
            .collect();
        assert_eq!(
            lines,
            vec![
                ("context", Some(10), Some(10), "a\n"),
                ("deletion", Some(11), None, "b\n"),
                ("addition", None, Some(11), "c\n"),
                ("addition", None, Some(12), "d\n"),
                ("context", Some(12), Some(13), "e\n"),
            ]
        );
    }

    #[test]
    fn patch_handles_multiple_hunks_and_single_line_ranges() {
        let hunks = parse_patch("@@ -1 +1 @@\n-a\n+b\n@@ -0,0 +5,2 @@\n+x\n+y").unwrap();
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].lines[1].new_line_no, Some(1));
        assert_eq!(hunks[1].lines[1].new_line_no, Some(6));
    }

    #[test]
    fn patch_with_broken_header_is_rejected() {
        assert_eq!(parse_patch("@@ nonsense @@\n+a"), None);
    }

    #[test]
    fn files_keep_renames_and_mark_missing_patches() {
        let files = parse_pr_files(fixture("files").as_array().unwrap(), false);
        assert_eq!(files.files.len(), 3);
        assert_eq!(files.files[0].status, "modified");
        assert_eq!(files.files[0].hunks.as_ref().map(Vec::len), Some(1));
        assert_eq!(files.files[1].old_path.as_deref(), Some("docs/old.md"));
        assert_eq!(files.files[1].status, "renamed");
        // 바이너리·큰 파일은 patch 가 없다.
        assert_eq!(files.files[2].hunks, None);
    }
}
