// SPDX-License-Identifier: GPL-3.0-or-later
//! V6 — scope drift.
//!
//! The commit subject declares a scope (`feat(diff): …`); the diff declares the
//! truth. When they disagree, the commit message is describing work that is not
//! all of the work.
//!
//! Path-based only, so it is language-agnostic: no file is ever "unsupported"
//! for this rule. A message without a conventional-commit scope is reported as
//! *unchecked*, never as a pass.

use crate::verify::types::{Finding, FindingKind, UncheckedReason};

use super::context::{DiffContext, RuleOutcome};
use super::patterns;

pub const KINDS: &[FindingKind] = &[FindingKind::ScopeDrift];

/// Scopes that intentionally span the repository — judging them would be noise.
const WILDCARD_SCOPES: &[&str] = &["*", "all", "deps", "release", "repo", "misc", "root"];

/// Shortest scope/segment that may match by substring rather than equality.
const MIN_FUZZY_LEN: usize = 3;

const MAX_LISTED_PATHS: usize = 10;

pub fn run(ctx: &DiffContext) -> RuleOutcome {
    let mut out = RuleOutcome::new();

    let Some(message) = commit_message(ctx) else {
        out.limit(
            FindingKind::ScopeDrift,
            UncheckedReason::NotApplicable,
            Some("no commit message available".to_string()),
        );
        return out;
    };

    let Some(header) = parse_conventional_header(&message) else {
        out.limit(
            FindingKind::ScopeDrift,
            UncheckedReason::ParseFailed,
            Some("subject is not a conventional commit".to_string()),
        );
        return out;
    };

    let scopes = header.scopes();
    if scopes.is_empty() {
        out.limit(
            FindingKind::ScopeDrift,
            UncheckedReason::NotApplicable,
            Some(format!("subject '{}' declares no scope", header.kind)),
        );
        return out;
    }
    if scopes.iter().any(|s| WILDCARD_SCOPES.contains(&s.as_str())) {
        out.limit(
            FindingKind::ScopeDrift,
            UncheckedReason::NotApplicable,
            Some(format!("scope '{}' spans the repository", scopes.join(","))),
        );
        return out;
    }
    if ctx.files.is_empty() {
        out.limit(
            FindingKind::ScopeDrift,
            UncheckedReason::NotApplicable,
            Some("no files in this diff".to_string()),
        );
        return out;
    }

    out.check(FindingKind::ScopeDrift);

    let outside: Vec<&str> = ctx
        .files
        .iter()
        .filter(|file| {
            !scopes
                .iter()
                .any(|scope| path_matches_scope(&file.path, scope))
        })
        .map(|file| file.path.as_str())
        .collect();

    if outside.is_empty() {
        return out;
    }

    let total = ctx.files.len();
    let inside = total - outside.len();
    let message = if inside == 0 {
        format!(
            "no changed file matches scope '{}' ({} files)",
            scopes.join(","),
            total
        )
    } else {
        format!(
            "scope '{}' matches {} of {} changed files",
            scopes.join(","),
            inside,
            total
        )
    };

    let listed: Vec<String> = outside
        .iter()
        .take(MAX_LISTED_PATHS)
        .map(|p| p.to_string())
        .collect();
    let mut detail = listed;
    if outside.len() > MAX_LISTED_PATHS {
        detail.push(format!("+{} more", outside.len() - MAX_LISTED_PATHS));
    }

    out.push(
        Finding::new(FindingKind::ScopeDrift, String::new(), message)
            .with_detail(patterns::detail_from(&detail)),
    );

    out
}

fn commit_message(ctx: &DiffContext) -> Option<String> {
    ctx.commit
        .as_ref()
        .map(|c| c.message.clone())
        .or_else(|| ctx.draft_message.clone())
        .filter(|m| !m.trim().is_empty())
}

/// `type(scope)!: subject` — the commitlint header this repository enforces.
#[derive(Debug, PartialEq, Eq)]
pub struct ConventionalHeader {
    pub kind: String,
    pub scope: Option<String>,
    pub breaking: bool,
    pub subject: String,
}

impl ConventionalHeader {
    /// commitlint allows `feat(a,b): …`; each part is matched independently.
    fn scopes(&self) -> Vec<String> {
        self.scope
            .iter()
            .flat_map(|scope| scope.split(','))
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .collect()
    }
}

pub fn parse_conventional_header(message: &str) -> Option<ConventionalHeader> {
    let subject_line = message.lines().next()?.trim();
    let (head, subject) = subject_line.split_once(':')?;
    let head = head.trim();
    if head.is_empty() {
        return None;
    }

    let breaking = head.ends_with('!');
    let head = head.trim_end_matches('!');

    let (kind, scope) = match head.split_once('(') {
        Some((kind, rest)) => {
            let scope = rest.strip_suffix(')')?;
            (kind, Some(scope.to_string()))
        }
        None => (head, None),
    };

    let kind = kind.trim();
    // commitlint's default `type-case` rule is lower-case, so a bare lowercase
    // word is the type and anything else is prose that happens to hold a colon
    // ("WIP: …", "Revert \"feat(x): y\"").
    if kind.is_empty() || !kind.chars().all(|c| c.is_ascii_lowercase()) {
        return None;
    }

    Some(ConventionalHeader {
        kind: kind.to_string(),
        scope,
        breaking,
        subject: subject.trim().to_string(),
    })
}

/// A path is inside the scope when one of its segments names the scope.
/// The last segment is compared without its extension so that
/// `commands/git.rs` matches `git`.
fn path_matches_scope(path: &str, scope: &str) -> bool {
    path.split('/').any(|segment| {
        let segment = segment.to_ascii_lowercase();
        let stem = segment.rsplit_once('.').map(|(s, _)| s).unwrap_or(&segment);
        segment_matches(&segment, scope) || segment_matches(stem, scope)
    })
}

fn segment_matches(segment: &str, scope: &str) -> bool {
    if segment == scope {
        return true;
    }
    if scope.len() >= MIN_FUZZY_LEN && segment.contains(scope) {
        return true;
    }
    segment.len() >= MIN_FUZZY_LEN && scope.contains(segment)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::verify::rules::context::{context_from_unified, CommitContext, DiffContext};

    fn diff_for(paths: &[&str]) -> String {
        paths
            .iter()
            .map(|p| {
                format!(
                    "diff --git a/{p} b/{p}\n--- a/{p}\n+++ b/{p}\n@@ -1,1 +1,1 @@\n-a\n+b\n",
                    p = p
                )
            })
            .collect()
    }

    fn ctx_with(message: &str, paths: &[&str]) -> DiffContext {
        context_from_unified(
            Path::new("/repo"),
            &diff_for(paths),
            Some(CommitContext {
                oid: "abc1234".to_string(),
                message: message.to_string(),
                parent_ids: vec![],
                author_email: "a@b.c".to_string(),
                trailers: vec![],
            }),
            None,
        )
    }

    #[test]
    fn parses_conventional_headers() {
        let h = parse_conventional_header("feat(diff): add markdown view\n\nbody").unwrap();
        assert_eq!(h.kind, "feat");
        assert_eq!(h.scope.as_deref(), Some("diff"));
        assert!(!h.breaking);
        assert_eq!(h.subject, "add markdown view");

        let breaking = parse_conventional_header("refactor(git)!: drop cli").unwrap();
        assert!(breaking.breaking);
        assert_eq!(breaking.scope.as_deref(), Some("git"));

        let scopeless = parse_conventional_header("chore: bump").unwrap();
        assert!(scopeless.scope.is_none());

        assert!(parse_conventional_header("just a message").is_none());
        assert!(parse_conventional_header("WIP: 작업 중").is_none());
    }

    #[test]
    fn no_finding_when_every_file_is_in_scope() {
        let out = run(&ctx_with(
            "feat(diff): add markdown view",
            &[
                "src/components/diff/DiffViewer.tsx",
                "src-tauri/src/git/diff.rs",
            ],
        ));
        assert!(out.findings.is_empty());
        assert_eq!(out.checked, vec!["v6.scopeDrift".to_string()]);
    }

    #[test]
    fn flags_files_outside_the_declared_scope() {
        let out = run(&ctx_with(
            "feat(diff): add markdown view",
            &[
                "src/components/diff/DiffViewer.tsx",
                "src/stores/account.ts",
                "src-tauri/src/commands/auth.rs",
            ],
        ));
        assert_eq!(out.findings.len(), 1);
        assert_eq!(
            out.findings[0].message,
            "scope 'diff' matches 1 of 3 changed files"
        );
        // Commit-level finding: no file anchor.
        assert_eq!(out.findings[0].file, "");
        let detail = out.findings[0].detail.as_deref().unwrap_or_default();
        assert!(detail.contains("src/stores/account.ts"));
    }

    #[test]
    fn flags_a_scope_that_matches_nothing() {
        let out = run(&ctx_with("fix(branch): rename", &["README.md"]));
        assert_eq!(
            out.findings[0].message,
            "no changed file matches scope 'branch' (1 files)"
        );
    }

    #[test]
    fn multi_scope_subjects_match_either_scope() {
        let out = run(&ctx_with(
            "feat(diff,history): share the viewer",
            &[
                "src/components/diff/DiffViewer.tsx",
                "src/components/history/Timeline.tsx",
            ],
        ));
        assert!(out.findings.is_empty());
    }

    #[test]
    fn scopeless_and_wildcard_subjects_are_unchecked_not_passing() {
        let scopeless = run(&ctx_with("chore: bump deps", &["package.json"]));
        assert!(scopeless.findings.is_empty());
        assert!(scopeless.checked.is_empty());
        assert_eq!(scopeless.limits[0].reason, UncheckedReason::NotApplicable);

        let wildcard = run(&ctx_with("chore(deps): bump", &["package.json"]));
        assert!(wildcard.checked.is_empty());
        assert_eq!(wildcard.limits.len(), 1);
    }

    #[test]
    fn unparsable_subject_is_reported_as_parse_failed() {
        let out = run(&ctx_with("WIP", &["src/a.ts"]));
        assert!(out.checked.is_empty());
        assert_eq!(out.limits[0].reason, UncheckedReason::ParseFailed);
    }

    #[test]
    fn draft_message_is_used_for_a_working_tree_scan() {
        let ctx = context_from_unified(
            Path::new("/repo"),
            &diff_for(&["src/stores/account.ts"]),
            None,
            Some("feat(branch): add switcher".to_string()),
        );
        let out = run(&ctx);
        assert_eq!(out.findings.len(), 1);
        assert!(out.checked.contains(&"v6.scopeDrift".to_string()));
    }

    #[test]
    fn missing_message_is_unchecked() {
        let ctx = context_from_unified(Path::new("/repo"), &diff_for(&["src/a.ts"]), None, None);
        let out = run(&ctx);
        assert!(out.checked.is_empty());
        assert_eq!(out.limits[0].reason, UncheckedReason::NotApplicable);
    }
}
