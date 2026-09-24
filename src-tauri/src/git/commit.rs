use std::collections::HashMap;

use git2::Repository;

use crate::error::AppError;
use crate::git::engine::{AuthorInfo, CoAuthor, CommitInfo, RefKind, RefLabel};

/// Validate a commit message — must not be empty or whitespace-only.
pub fn validate_message(message: &str) -> Result<(), AppError> {
    if message.trim().is_empty() {
        return Err(AppError::GitCli {
            message: "Commit message cannot be empty".to_string(),
            exit_code: None,
        });
    }
    Ok(())
}

/// Validate a commit id (oid) for use as a git CLI argument.
/// Must be hex only and 4..=64 chars — this both rejects garbage and prevents
/// option injection (a leading '-' is not a hex digit).
pub fn validate_commit_oid(oid: &str) -> Result<(), AppError> {
    let valid = (4..=64).contains(&oid.len()) && oid.chars().all(|c| c.is_ascii_hexdigit());
    if !valid {
        return Err(AppError::GitCli {
            message: format!("Invalid commit id: '{}'", oid),
            exit_code: None,
        });
    }
    Ok(())
}

/// Extract the subject line (first line) from a commit message.
pub fn subject_line(message: &str) -> &str {
    message.lines().next().unwrap_or("").trim()
}

/// Extract the body (everything after the subject + blank line) from a commit message.
pub fn body_text(message: &str) -> &str {
    // Find the first newline (end of subject line)
    if let Some(pos) = message.find('\n') {
        let rest = &message[pos + 1..];
        // Skip optional blank separator line
        rest.trim_start_matches('\n')
    } else {
        ""
    }
}

/// Convert a git2 `Signature` into our `AuthorInfo`.
pub fn signature_to_author(sig: &git2::Signature<'_>) -> AuthorInfo {
    AuthorInfo {
        name: sig.name().unwrap_or("Unknown").to_string(),
        email: sig.email().unwrap_or("").to_string(),
        timestamp: sig.when().seconds(),
    }
}

/// Names of coding agents whose commits we mark as agent-authored. The single
/// source for this list — every commit response (`commit_to_info`,
/// `get_commit_history`, `get_commit_detail`) goes through `agent_attribution`.
/// Matched case-insensitively against whole words of a name, so
/// "Claude Opus 4.5" and "github-copilot[bot]" both match.
pub const AGENT_NAMES: &[&str] = &["Claude", "Codex", "Copilot", "Cursor", "Gemini", "Devin", "Aider"];

/// Parse `Co-Authored-By: Name <email>` trailers from a commit message.
///
/// The key is matched case-insensitively (`Co-authored-by`, `CO-AUTHORED-BY`).
/// Every line is scanned rather than only the last paragraph, because agents
/// often put other trailers or notes after a blank line. Duplicates (same
/// email, or same name when there is no email) are dropped, keeping the first.
pub fn parse_co_authors(message: &str) -> Vec<CoAuthor> {
    let mut result: Vec<CoAuthor> = Vec::new();
    for line in message.lines() {
        let Some((key, value)) = line.trim().split_once(':') else {
            continue;
        };
        if !key.trim().eq_ignore_ascii_case("co-authored-by") {
            continue;
        }
        let Some(co_author) = co_author_from_value(value.trim()) else {
            continue;
        };
        let is_duplicate = result.iter().any(|c| {
            if co_author.email.is_empty() {
                c.email.is_empty() && c.name.eq_ignore_ascii_case(&co_author.name)
            } else {
                c.email.eq_ignore_ascii_case(&co_author.email)
            }
        });
        if !is_duplicate {
            result.push(co_author);
        }
    }
    result
}

/// Split a trailer value `Name <email>` (email optional) into a `CoAuthor`.
fn co_author_from_value(value: &str) -> Option<CoAuthor> {
    let (name, email) = match (value.find('<'), value.rfind('>')) {
        (Some(open), Some(close)) if open < close => {
            (value[..open].trim(), value[open + 1..close].trim())
        }
        _ => (value, ""),
    };
    if name.is_empty() && email.is_empty() {
        return None;
    }
    Some(CoAuthor { name: name.to_string(), email: email.to_string() })
}

/// True when any whole word of `name` equals one of `AGENT_NAMES` (ignoring case).
pub fn is_agent_name(name: &str) -> bool {
    name.split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .any(|word| AGENT_NAMES.iter().any(|agent| agent.eq_ignore_ascii_case(word)))
}

/// Co-authors and the agent-authored guess for one commit. Shared by every
/// commit response so the history list, commit detail and branch compare agree.
pub fn agent_attribution(message: &str, author_name: &str) -> (Vec<CoAuthor>, bool) {
    let co_authors = parse_co_authors(message);
    let is_agent_authored =
        is_agent_name(author_name) || co_authors.iter().any(|c| is_agent_name(&c.name));
    (co_authors, is_agent_authored)
}

/// Full SHAs of a commit's parents, in parent order (first parent first).
pub fn parent_ids(commit: &git2::Commit<'_>) -> Vec<String> {
    commit.parent_ids().map(|oid| oid.to_string()).collect()
}

/// Convert a git2 `Commit` into our `CommitInfo`.
pub fn commit_to_info(commit: &git2::Commit<'_>) -> CommitInfo {
    let id = commit.id().to_string();
    let short_id = id[..8.min(id.len())].to_string();
    let message = commit.message().unwrap_or("").to_string();
    let summary = subject_line(&message).to_string();
    let author = signature_to_author(&commit.author());
    let committer = signature_to_author(&commit.committer());
    let timestamp = commit.time().seconds();
    let parent_ids = parent_ids(commit);
    let (co_authors, is_agent_authored) = agent_attribution(&message, &author.name);

    CommitInfo {
        id,
        short_id,
        message,
        summary,
        author,
        committer,
        timestamp,
        parent_ids,
        refs: Vec::new(),
        co_authors,
        is_agent_authored,
    }
}

/// Build a map from commit OID → refs (tags/branches) pointing at it.
/// Annotated tags are peeled to the commit they ultimately reference, so both
/// lightweight and annotated tags land on the right commit. Symbolic refs like
/// `origin/HEAD` are skipped since they are not real branches.
pub fn build_ref_map(repo: &Repository) -> HashMap<git2::Oid, Vec<RefLabel>> {
    // Name of the currently checked-out local branch, if HEAD is not detached.
    let head_branch = repo
        .head()
        .ok()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(String::from));

    let mut map: HashMap<git2::Oid, Vec<RefLabel>> = HashMap::new();

    let Ok(references) = repo.references() else {
        return map;
    };

    for reference in references.flatten() {
        // Resolve to the commit this ref ultimately points at.
        let Ok(commit) = reference.peel_to_commit() else {
            continue;
        };
        let oid = commit.id();
        let short = reference.shorthand().unwrap_or("");
        if short.is_empty() {
            continue;
        }

        let (name, kind) = if reference.is_tag() {
            (short.to_string(), RefKind::Tag)
        } else if reference.is_remote() {
            if short.ends_with("/HEAD") {
                continue;
            }
            (short.to_string(), RefKind::RemoteBranch)
        } else if reference.is_branch() {
            (short.to_string(), RefKind::LocalBranch)
        } else {
            continue;
        };

        let is_head =
            kind == RefKind::LocalBranch && head_branch.as_deref() == Some(name.as_str());

        map.entry(oid).or_default().push(RefLabel { name, kind, is_head });
    }

    // Order within a commit: HEAD first, then local branches, remotes, tags.
    for labels in map.values_mut() {
        labels.sort_by_key(|l| match (l.is_head, &l.kind) {
            (true, _) => 0,
            (false, RefKind::LocalBranch) => 1,
            (false, RefKind::RemoteBranch) => 2,
            (false, RefKind::Tag) => 3,
        });
    }

    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_full_length_lowercase_hex_oid() {
        let oid = "0123456789abcdef0123456789abcdef01234567"; // 40 chars
        assert!(validate_commit_oid(oid).is_ok());
    }

    #[test]
    fn accepts_short_hex_oid() {
        assert!(validate_commit_oid("1a2b3c4").is_ok()); // 7 chars
    }

    #[test]
    fn rejects_too_short_oid() {
        assert!(validate_commit_oid("abc").is_err()); // 3 chars
    }

    #[test]
    fn rejects_too_long_oid() {
        let oid = "a".repeat(65); // 65 chars
        assert!(validate_commit_oid(&oid).is_err());
    }

    #[test]
    fn rejects_non_hex_chars() {
        assert!(validate_commit_oid("zzzz1234").is_err());
    }

    #[test]
    fn rejects_leading_dash_option_injection() {
        assert!(validate_commit_oid("-rf").is_err());
    }

    fn co(name: &str, email: &str) -> CoAuthor {
        CoAuthor { name: name.to_string(), email: email.to_string() }
    }

    #[test]
    fn parses_co_author_trailer_regardless_of_key_case() {
        let message = "feat: x\n\nco-authored-by: Alice <a@x.io>\nCO-AUTHORED-BY:Bob <b@x.io>";
        assert_eq!(parse_co_authors(message), vec![co("Alice", "a@x.io"), co("Bob", "b@x.io")]);
    }

    #[test]
    fn parses_multiple_trailer_lines_and_skips_other_trailers() {
        let message = "fix: y\n\nbody text\n\n\
            Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>\n\
            Signed-off-by: Dev <dev@x.io>\n\
            Co-Authored-By: Carol <c@x.io>\n\
            \n\
            Claude-Session: https://example.com/s";
        assert_eq!(
            parse_co_authors(message),
            vec![co("Claude Opus 4.5", "noreply@anthropic.com"), co("Carol", "c@x.io")]
        );
    }

    #[test]
    fn drops_duplicate_co_authors_and_keeps_trailer_without_email() {
        let message = "x\n\nCo-Authored-By: A <a@x.io>\nCo-Authored-By: A again <A@X.IO>\nCo-Authored-By: Codex";
        assert_eq!(parse_co_authors(message), vec![co("A", "a@x.io"), co("Codex", "")]);
    }

    #[test]
    fn no_trailer_yields_empty_list() {
        assert!(parse_co_authors("chore: bump\n\nJust a body. Co-authored by nobody.").is_empty());
        assert!(parse_co_authors("").is_empty());
    }

    #[test]
    fn agent_attribution_matches_whole_words_ignoring_case() {
        let (co_authors, is_agent) =
            agent_attribution("x\n\nCo-Authored-By: claude <noreply@anthropic.com>", "Dev");
        assert_eq!(co_authors.len(), 1);
        assert!(is_agent);

        // The author alone can mark the commit (e.g. a bot account).
        assert!(agent_attribution("x", "github-copilot[bot]").1);
        // "Claudette" is not "Claude": only whole words count.
        assert!(!agent_attribution("x\n\nCo-Authored-By: Claudette <c@x.io>", "Dev").1);
        assert!(!agent_attribution("x", "Dev").1);
    }

    #[test]
    fn commit_to_info_reports_both_parents_of_a_merge_commit() {
        let dir = std::env::temp_dir()
            .join(format!("gitbaro-merge-parents-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = Repository::init(&dir).unwrap();
        let sig = git2::Signature::now("Dev", "dev@x.io").unwrap();
        let tree_id = repo.treebuilder(None).unwrap().write().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();

        let root = repo.commit(None, &sig, &sig, "root", &tree, &[]).unwrap();
        let root_commit = repo.find_commit(root).unwrap();
        let left = repo.commit(None, &sig, &sig, "left", &tree, &[&root_commit]).unwrap();
        let right = repo.commit(None, &sig, &sig, "right", &tree, &[&root_commit]).unwrap();
        let left_commit = repo.find_commit(left).unwrap();
        let right_commit = repo.find_commit(right).unwrap();
        let merge = repo
            .commit(
                None,
                &sig,
                &sig,
                "Merge right\n\nCo-Authored-By: Codex <codex@openai.com>",
                &tree,
                &[&left_commit, &right_commit],
            )
            .unwrap();

        let info = commit_to_info(&repo.find_commit(merge).unwrap());
        let root_info = commit_to_info(&root_commit);
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(info.parent_ids, vec![left.to_string(), right.to_string()]);
        assert_eq!(info.co_authors, vec![co("Codex", "codex@openai.com")]);
        assert!(info.is_agent_authored);
        assert!(root_info.parent_ids.is_empty());
        assert!(!root_info.is_agent_authored);
    }
}
