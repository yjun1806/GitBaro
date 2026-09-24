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
/// Matched case-insensitively against whole words of a co-author name, so
/// "Claude Opus 4.5" and "gemini-code-assist[bot]" both match. A name match
/// alone is not enough: see `is_agent_co_author`.
pub const AGENT_NAMES: &[&str] = &["Claude", "Codex", "Copilot", "Cursor", "Gemini", "Devin", "Aider"];

/// Email domains that only coding agents commit from. A co-author with one of
/// these is an agent whatever the name says.
pub const AGENT_EMAIL_DOMAINS: &[&str] = &["anthropic.com", "openai.com", "cursor.com", "aider.chat"];

/// Parse `Co-Authored-By: Name <email>` trailers from a commit message.
///
/// Only the trailer block is read, as git does: the paragraphs at the end of
/// the message whose every line is `Key: value` with no leading space. Several
/// such paragraphs in a row all count, because agents often put another
/// trailer (e.g. `Claude-Session:`) after a blank line. The subject paragraph
/// never counts, and neither does indented or quoted text in the body. The key
/// is matched case-insensitively. Duplicates (same email, or same name when
/// there is no email) are dropped, keeping the first.
pub fn parse_co_authors(message: &str) -> Vec<CoAuthor> {
    let mut result: Vec<CoAuthor> = Vec::new();
    for (key, value) in trailer_lines(message) {
        if !key.eq_ignore_ascii_case("co-authored-by") {
            continue;
        }
        let Some(co_author) = co_author_from_value(value) else {
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

/// `(key, value)` pairs of the trailer block at the end of `message`, in order.
fn trailer_lines(message: &str) -> Vec<(&str, &str)> {
    // Paragraphs are runs of non-blank lines; whitespace-only lines separate them.
    let paragraphs: Vec<Vec<&str>> = message
        .lines()
        .collect::<Vec<_>>()
        .split(|l| l.trim().is_empty())
        .filter(|lines| !lines.is_empty())
        .map(<[&str]>::to_vec)
        .collect();
    // The first paragraph is the subject (plus any body glued to it).
    let body = paragraphs.get(1..).unwrap_or(&[]);
    let block_start = body
        .iter()
        .rposition(|lines| !lines.iter().all(|l| as_trailer(l).is_some()))
        .map_or(0, |i| i + 1);
    body[block_start..]
        .iter()
        .flatten()
        .filter_map(|l| as_trailer(l))
        .collect()
}

/// Split a trailer line `Key: value`. `None` for indented lines and for keys
/// that are not a single token of letters, digits and dashes.
fn as_trailer(line: &str) -> Option<(&str, &str)> {
    if line.starts_with(char::is_whitespace) {
        return None;
    }
    let (key, value) = line.split_once(':')?;
    let is_token = !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    is_token.then(|| (key, value.trim()))
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
fn has_agent_name(name: &str) -> bool {
    name.split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .any(|word| AGENT_NAMES.iter().any(|agent| agent.eq_ignore_ascii_case(word)))
}

/// True when a co-author looks like a coding agent rather than a person.
///
/// "Claude" and "Devin" are also human first names, so the name only counts
/// together with an address no person commits from: none at all, a `noreply`
/// address (GitHub bot accounts use `…@users.noreply.github.com`), or an
/// agent vendor's domain (`AGENT_EMAIL_DOMAINS`, enough on its own).
/// `Devin Kim <devin@corp.com>` is therefore a person.
pub fn is_agent_co_author(co_author: &CoAuthor) -> bool {
    let email = co_author.email.to_ascii_lowercase();
    let domain = email.rsplit_once('@').map_or("", |(_, d)| d);
    if AGENT_EMAIL_DOMAINS
        .iter()
        .any(|d| domain == *d || domain.ends_with(&format!(".{d}")))
    {
        return true;
    }
    let is_non_personal_email = email.is_empty() || email.contains("noreply");
    is_non_personal_email && has_agent_name(&co_author.name)
}

/// Co-authors and the agent-authored guess for one commit, from its
/// `Co-Authored-By` trailers only (the commit author is not considered — a
/// person may well be called Claude). Shared by every commit response so the
/// history list, commit detail and branch compare agree.
pub fn agent_attribution(message: &str) -> (Vec<CoAuthor>, bool) {
    let co_authors = parse_co_authors(message);
    let is_agent_authored = co_authors.iter().any(is_agent_co_author);
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
    let (co_authors, is_agent_authored) = agent_attribution(&message);

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
    fn agent_attribution_matches_agent_trailers_by_whole_word() {
        let (co_authors, is_agent) =
            agent_attribution("x\n\nCo-Authored-By: claude <noreply@anthropic.com>");
        assert_eq!(co_authors.len(), 1);
        assert!(is_agent);

        // GitHub bot accounts: agent name + noreply address.
        assert!(agent_attribution(
            "x\n\nCo-authored-by: Copilot <175728472+Copilot@users.noreply.github.com>"
        )
        .1);
        // A name-only trailer has no personal address to contradict it.
        assert!(agent_attribution("x\n\nCo-Authored-By: Codex").1);
        // An agent vendor domain is enough on its own.
        assert!(agent_attribution("x\n\nCo-Authored-By: Assistant <bot@openai.com>").1);
        // "Claudette" is not "Claude": only whole words count.
        assert!(!agent_attribution("x\n\nCo-Authored-By: Claudette <noreply@x.io>").1);
        assert!(!agent_attribution("x").1);
    }

    /// "Claude" and "Devin" are also human first names. A person's own address
    /// keeps them unmarked, and the commit author is never looked at.
    #[test]
    fn human_named_like_an_agent_is_not_marked() {
        let (co_authors, is_agent) =
            agent_attribution("feat: x\n\nCo-authored-by: Devin Kim <devin@corp.com>");
        assert_eq!(co_authors, vec![co("Devin Kim", "devin@corp.com")]);
        assert!(!is_agent);
        assert!(!agent_attribution("x\n\nCo-Authored-By: Claude Martin <claude@martin.fr>").1);
    }

    #[test]
    fn reads_only_the_trailer_block_at_the_end() {
        // A trailer quoted (indented) in the body, followed by more prose.
        let quoted = "chore: stop adding agent trailer\n\n\
            Old messages ended with:\n    \
            Co-Authored-By: Claude <noreply@anthropic.com>\n\n\
            This removes it.";
        assert_eq!(agent_attribution(quoted), (vec![], false));

        // The subject line is never a trailer.
        assert!(parse_co_authors("co-authored-by: fix typo").is_empty());
        assert!(parse_co_authors("co-authored-by: fix typo\n\nbody").is_empty());

        // A trailer-shaped line inside a prose paragraph is not a trailer.
        assert!(parse_co_authors("x\n\nSee co-authored-by: Bob <b@x.io> above\nfor details").is_empty());
        // A trailer paragraph followed by prose is not the trailer block.
        assert!(parse_co_authors("x\n\nCo-Authored-By: Bob <b@x.io>\n\nMore text.").is_empty());
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
