//! The session report — one narrative per agent session (session-report §3).
//!
//! The verification subsystem produces *signals*. A signal with no decision
//! attached is noise, and 38 of them is a pile. This module is the container
//! that turns them into one page answering five questions in order: what was
//! asked, what was done, what it went through, what is affected, and what
//! differs from what was asked.
//!
//! Nothing here re-implements a rule. Every section reads an existing evidence
//! source — the session summary, the correlation link, the tree-sitter symbol
//! index — and arranges it. The rule engine was not deleted; it was demoted to
//! the evidence supply.
//!
//! Three invariants (§3.12):
//!
//! 1. **Assembly never errors.** A missing index, a refused attribution and a
//!    log we could not finish reading are all `unavailable`, never an error
//!    toast. Only failing to open the named session file is a real failure, and
//!    that happens in the command layer.
//! 2. **`DidSection::files` is never empty** when the session edited anything.
//!    File edits are written in the log; only the commit half is inferred.
//! 3. **A section with `unavailable: Some(_)` has empty body fields.** Half a
//!    section is worse than none — the reader cannot tell which half is real.

pub mod asked;
pub mod did;
pub mod drift;
pub mod impact;
pub mod model;
pub mod ordeal;

#[cfg(test)]
mod testutil;

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::time::Instant;

use git2::Repository;

use crate::verify::context::{IndexState, RepoIndex};
use crate::verify::session::attribution::{self, AttributionContext};
use crate::verify::session::correlate;
use crate::verify::types::{now_millis, LinkConfidence, SessionCommitLink, SessionSummary};

use did::CommitSnapshot;
use model::{
    ImpactBasis, ReportHeader, SessionDigest, SessionReport, Unavailable, UnavailableReason,
};

// ── Budgets (§3.11) ──────────────────────────────────────────────────────────

pub const MAX_REPORT_PROMPTS: usize = 40;
pub const MAX_REPORT_EVENTS: usize = 120;
pub const MAX_REPORT_FILES: usize = 300;
pub const MAX_DRIFT_PATHS: usize = 20;
/// Prompt mentions listed. Resolved anchors sort first, so the cap only ever
/// removes leftovers that did not narrow scope anyway.
pub const MAX_PROMPT_MENTIONS: usize = 20;
pub const MAX_IMPACT_ENTRIES: usize = 30;
/// Raw evidence (a command line, a path) carried on one event.
pub const MAX_EVIDENCE_CHARS: usize = 512;
/// Failing commands quoted alongside a test edit.
pub const MAX_FAILING_COMMANDS: usize = 5;
/// How far back attribution looks for candidate commits.
pub const MAX_COMMIT_WALK: usize = 200;
/// Below this share of changed paths, the anchors are too thin to rank by (G2).
pub const MIN_ANCHOR_COVERAGE: f32 = 0.2;
/// Wall-clock budget for assembling one report. Exceeding it closes the
/// remaining sections with `unavailable{ParseBudget}` — it is not an error.
pub const MAX_REPORT_MILLIS: u128 = 3_000;

/// Assemble the whole report for one session, in one blocking pass.
///
/// Infallible by design: every git or index failure degrades to an
/// `unavailable` section rather than an error the user has to dismiss.
pub fn build_report(
    repo: &Repository,
    repo_path: &Path,
    summary: &SessionSummary,
    index: Option<&RepoIndex>,
    index_state: IndexState,
) -> SessionReport {
    let started = Instant::now();
    let ctx = attribution_context(repo, repo_path);

    let asked = asked::build(summary);
    let went_through = ordeal::build(summary);

    let snapshots = did::collect_commit_snapshots(repo, MAX_COMMIT_WALK).unwrap_or_else(|e| {
        tracing::debug!("[report] commit walk skipped: {}", e);
        Vec::new()
    });
    let link = correlate_one(repo, &ctx, summary, &snapshots);
    let did = did::build(&ctx, summary, &snapshots, link.as_ref());

    let attributed = did::attributed(&snapshots, &did);
    let session_paths = did::edited_paths(&ctx, summary);
    let basis = if attributed.is_empty() {
        ImpactBasis::WorktreeFallback
    } else {
        ImpactBasis::AttributedCommitRange
    };

    let impact = impact::build(&impact::ImpactInput {
        repo,
        repo_root: repo_path,
        session_paths: &session_paths,
        attributed: &attributed,
        index,
        index_state,
        over_budget: started.elapsed().as_millis() > MAX_REPORT_MILLIS,
    });

    let drift = if started.elapsed().as_millis() > MAX_REPORT_MILLIS {
        drift_unavailable(basis)
    } else {
        let anchors =
            drift::RepoAnchors::new(tracked_files(repo), drift::detect_path_alias(repo_path));
        drift::build(&drift::DriftInput {
            prompts: &asked.prompts,
            anchors: &anchors,
            index,
            changed: &changed_paths(&ctx, summary, &attributed),
            basis,
            attribution: did.attribution.as_ref().map(|a| a.confidence),
            partial_log: is_partial(summary),
        })
    };

    SessionReport {
        header: header_for(&ctx, summary),
        asked,
        did,
        went_through,
        impact,
        drift,
        generated_at: now_millis(),
    }
}

/// The list row for one session, and the only input to the "is there anything
/// to show?" gate. Deliberately cheap: no symbol index, no diff.
pub fn digest_for(summary: &SessionSummary, link: Option<&SessionCommitLink>) -> SessionDigest {
    let attribution = link
        .filter(|link| link.confidence != LinkConfidence::Low && !link.commit_ids.is_empty())
        .map(|link| link.confidence);

    SessionDigest {
        session_id: summary.session_id.clone(),
        session_path: summary.file_path.clone(),
        source: summary.source,
        title: asked::title_for(summary),
        started_at: summary.started_at,
        ended_at: summary.ended_at,
        duration_ms: (summary.ended_at - summary.started_at).max(0),
        git_branch: summary.git_branch.clone(),
        files_edited_count: summary.files_edited.len(),
        commit_ids: match (attribution, link) {
            (Some(_), Some(link)) => link.commit_ids.clone(),
            _ => Vec::new(),
        },
        attribution,
        partial: is_partial(summary),
    }
}

/// Digests for every session belonging to `repo_path`, newest first.
///
/// Correlation runs once over the whole set rather than per session, so
/// parallel sessions can be arbitrated against each other — the same reason the
/// page itself is one command instead of seven.
pub fn digests_for(
    repo: &Repository,
    repo_path: &Path,
    summaries: &[SessionSummary],
) -> Vec<SessionDigest> {
    let ctx = attribution_context(repo, repo_path);
    let oids: Vec<String> = did::collect_commit_snapshots(repo, MAX_COMMIT_WALK)
        .unwrap_or_default()
        .into_iter()
        .map(|snapshot| snapshot.oid)
        .collect();
    let commits = attribution::commit_facts(repo, &oids).unwrap_or_default();
    let links = correlate::correlate(&ctx, summaries, &commits);

    let mut digests: Vec<SessionDigest> = summaries
        .iter()
        .map(|summary| {
            let link = links
                .iter()
                .find(|link| link.session_path == summary.file_path);
            digest_for(summary, link)
        })
        .collect();
    digests.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
    digests
}

// ── Header ───────────────────────────────────────────────────────────────────

fn header_for(ctx: &AttributionContext, summary: &SessionSummary) -> ReportHeader {
    ReportHeader {
        session_id: summary.session_id.clone(),
        session_path: summary.file_path.clone(),
        source: summary.source,
        started_at: summary.started_at,
        ended_at: summary.ended_at,
        duration_ms: (summary.ended_at - summary.started_at).max(0),
        cwd: summary.cwd.clone(),
        git_branch: summary.git_branch.clone(),
        title: asked::title_for(summary),
        cwd_relation: attribution::resolve_cwd_relation(ctx, Path::new(&summary.cwd)),
        partial: is_partial(summary),
        truncated: summary.truncated,
        skipped_records: summary.skipped_records,
        compaction_count: summary.compaction_boundaries.len(),
    }
}

/// A partially observed log makes every count in the report a floor.
fn is_partial(summary: &SessionSummary) -> bool {
    summary.truncated || summary.skipped_records > 0
}

// ── Shared inputs ────────────────────────────────────────────────────────────

/// The context correlation grades against. `user.email` decides which commits
/// could be this user's work at all, so it is resolved once per report.
fn attribution_context(repo: &Repository, repo_path: &Path) -> AttributionContext {
    let emails = repo
        .config()
        .and_then(|mut config| config.snapshot())
        .ok()
        .and_then(|snapshot| snapshot.get_string("user.email").ok());
    AttributionContext::for_repo(repo_path).with_emails(emails)
}

/// Every tracked path: the HEAD tree plus the index, so a file staged but not
/// yet committed still resolves as a V26 anchor.
fn tracked_files(repo: &Repository) -> BTreeSet<String> {
    let mut files = BTreeSet::new();

    if let Ok(tree) = repo.head().and_then(|head| head.peel_to_tree()) {
        let _ = tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
            if entry.kind() == Some(git2::ObjectType::Blob) {
                if let Some(name) = entry.name() {
                    files.insert(format!("{}{}", dir, name));
                }
            }
            git2::TreeWalkResult::Ok
        });
    }
    if let Ok(index) = repo.index() {
        for entry in index.iter() {
            if let Ok(path) = std::str::from_utf8(&entry.path) {
                files.insert(path.to_string());
            }
        }
    }
    files
}

/// The set V26 compares the prompt against: the attributed commits' changes
/// unioned with the session's own edits, or the session's edits alone.
fn changed_paths(
    ctx: &AttributionContext,
    summary: &SessionSummary,
    attributed: &[&CommitSnapshot],
) -> Vec<drift::ChangedPath> {
    // A path that stays absolute after normalisation lives outside this
    // repository — `/tmp/tsc.out` from a shell redirect is real, but it is not
    // a change to the codebase and must never be reported as drift.
    let churn: BTreeMap<String, u32> = summary
        .files_edited
        .iter()
        .map(|file| {
            (
                did::relative_path(ctx, summary, &file.path),
                file.edit_count,
            )
        })
        .filter(|(path, _)| !path.starts_with('/'))
        .collect();

    let mut entries: BTreeMap<String, drift::ChangedPath> = BTreeMap::new();
    for snapshot in attributed {
        for file in &snapshot.files {
            let entry = entries
                .entry(file.path.clone())
                .or_insert_with(|| drift::ChangedPath {
                    path: file.path.clone(),
                    edit_count: churn.get(&file.path).copied().unwrap_or(0),
                    added_lines: Some(0),
                    removed_lines: Some(0),
                    renamed_from: file.renamed_from.clone(),
                });
            entry.added_lines = Some(entry.added_lines.unwrap_or(0) + file.added);
            entry.removed_lines = Some(entry.removed_lines.unwrap_or(0) + file.removed);
        }
    }
    for (path, edit_count) in churn {
        entries
            .entry(path.clone())
            .or_insert_with(|| drift::ChangedPath {
                path,
                edit_count,
                added_lines: None,
                removed_lines: None,
                renamed_from: None,
            });
    }
    entries.into_values().collect()
}

fn correlate_one(
    repo: &Repository,
    ctx: &AttributionContext,
    summary: &SessionSummary,
    snapshots: &[CommitSnapshot],
) -> Option<SessionCommitLink> {
    let oids: Vec<String> = snapshots
        .iter()
        .map(|snapshot| snapshot.oid.clone())
        .collect();
    let commits = attribution::commit_facts(repo, &oids).unwrap_or_else(|e| {
        tracing::debug!("[report] commit facts skipped: {}", e);
        Vec::new()
    });
    correlate::correlate(ctx, std::slice::from_ref(summary), &commits)
        .into_iter()
        .next()
}

fn drift_unavailable(basis: ImpactBasis) -> model::DriftSection {
    model::DriftSection {
        unavailable: Some(Unavailable::with_detail(
            UnavailableReason::ParseBudget,
            "the report budget ran out before the prompt scope could be compared",
        )),
        mentions: Vec::new(),
        in_scope_paths: Vec::new(),
        drifted_paths: Vec::new(),
        drifted_total: 0,
        changed_total: 0,
        verdict: model::DriftVerdict::NoAnchor,
        confidence: LinkConfidence::Low,
        basis,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::context::index::fixture::index_from_sources;
    use crate::verify::hygiene::test_support::TempRepo;
    use crate::verify::report::model::{CwdRelation, DriftVerdict, OrdealKind};
    use crate::verify::session::test_support::{fixture, TempDir};
    use testutil::summarize_at;

    const LOGIN_BEFORE: &str = "export function login(id: string) { return id; }\n";
    const LOGIN_AFTER: &str = "export function login(id: string, force: boolean) { return id; }\n";
    const CALLER: &str =
        "import { login } from \"./auth/login\";\nexport const go = login(\"a\");\n";

    /// A repository plus a session log that edited the file the prompt named
    /// and committed it — the happy path all five sections answer.
    ///
    /// The seed commit is pushed a second into the past and the session window
    /// opens after it. Without that separation the seed is a legitimate
    /// candidate too — it also touches `login.ts` — and the fixture would be
    /// asserting on an ambiguity rather than on the report.
    fn scenario(prompt: &str, edited: &str) -> (TempRepo, TempDir, SessionSummary) {
        let temp = TempRepo::new();
        temp.commit(
            "feat: seed",
            &[("src/auth/login.ts", LOGIN_BEFORE), ("src/app.ts", CALLER)],
        );
        std::thread::sleep(std::time::Duration::from_millis(1_100));
        temp.commit(
            "refactor(auth): widen login",
            &[("src/auth/login.ts", LOGIN_AFTER)],
        );

        let root = temp.dir.to_string_lossy().to_string();
        let logs = TempDir::new();
        let body = fixture::lines(&[
            fixture::user_prompt(prompt, "2026-03-09T05:00:00.000Z"),
            fixture::assistant_read(
                "t1",
                &format!("{}/{}", root, edited),
                "2026-03-09T05:01:00.000Z",
            ),
            fixture::assistant_edit(
                "t2",
                &format!("{}/{}", root, edited),
                "2026-03-09T05:02:00.000Z",
                false,
            ),
            fixture::assistant_bash("t3", "pnpm test", "2026-03-09T05:03:00.000Z"),
            fixture::tool_result("t3", true, "2026-03-09T05:03:30.000Z"),
            fixture::assistant_bash("t4", "pnpm test", "2026-03-09T05:04:00.000Z"),
            fixture::tool_result("t4", true, "2026-03-09T05:04:30.000Z"),
            fixture::assistant_bash(
                "t5",
                "git commit --no-verify -m wip",
                "2026-03-09T05:05:00.000Z",
            ),
        ]);

        let head_ms = temp
            .repo
            .head()
            .and_then(|head| head.peel_to_commit())
            .expect("head")
            .time()
            .seconds()
            * 1000;

        let mut summary = summarize_at(&logs.write("s.jsonl", &body));
        summary.cwd = root;
        summary.git_branch = attribution::head_branch_name(&temp.repo);
        summary.started_at = head_ms - 500;
        summary.ended_at = head_ms + 60_000;
        summary.modified_at = summary.ended_at;

        (temp, logs, summary)
    }

    fn login_index() -> RepoIndex {
        index_from_sources(&[("src/auth/login.ts", LOGIN_AFTER), ("src/app.ts", CALLER)])
    }

    #[test]
    fn every_section_of_a_complete_session_answers_its_question() {
        let (temp, _logs, summary) =
            scenario("`src/auth/login.ts` 리팩터링 해줘", "src/auth/login.ts");
        let index = login_index();
        let report = build_report(
            &temp.repo,
            &temp.dir,
            &summary,
            Some(&index),
            IndexState::Ready,
        );

        // § header
        assert_eq!(report.header.cwd_relation, CwdRelation::ThisWorktree);
        assert_eq!(report.header.title, "`src/auth/login.ts` 리팩터링 해줘");
        assert!(!report.header.partial);

        // § what was asked
        assert_eq!(report.asked.prompts.len(), 1);
        assert!(report.asked.unavailable.is_none());

        // § what was done
        assert!(
            report.did.unavailable.is_none(),
            "{:?}",
            report.did.unavailable
        );
        assert_eq!(report.did.commits.len(), 1);
        assert_eq!(report.did.commits[0].summary, "refactor(auth): widen login");
        assert_eq!(report.did.files.len(), 1);
        assert_eq!(report.did.files[0].path, "src/auth/login.ts");
        assert!(report.did.files[0].in_commit);
        assert!(report.did.files[0].was_read_first);

        // § what it went through
        assert_eq!(report.went_through.failed_test_runs, 2);
        assert!(report
            .went_through
            .events
            .iter()
            .any(|event| event.kind == OrdealKind::HookBypass));

        // § what is affected — `login` gained a parameter and `src/app.ts`
        // still calls it with one argument.
        assert!(
            report.impact.unavailable.is_none(),
            "{:?}",
            report.impact.unavailable
        );
        assert_eq!(report.impact.basis, ImpactBasis::AttributedCommitRange);
        assert_eq!(report.impact.entries.len(), 1);
        assert_eq!(report.impact.entries[0].symbol, "login");

        // § what differs — the prompt named the only file that changed.
        assert!(
            report.drift.unavailable.is_none(),
            "{:?}",
            report.drift.unavailable
        );
        assert_eq!(report.drift.verdict, DriftVerdict::WithinScope);
    }

    #[test]
    fn a_repository_with_no_symbol_index_still_answers_the_other_four_sections() {
        let (temp, _logs, summary) =
            scenario("`src/auth/login.ts` 리팩터링 해줘", "src/auth/login.ts");
        let report = build_report(&temp.repo, &temp.dir, &summary, None, IndexState::Idle);

        assert_eq!(
            report.impact.unavailable.expect("reason").reason,
            UnavailableReason::NoSymbolIndex
        );
        assert!(report.impact.entries.is_empty());
        assert!(!report.did.files.is_empty());
        assert!(!report.asked.prompts.is_empty());
        assert!(report.drift.unavailable.is_none());
    }

    #[test]
    fn a_session_whose_prompt_names_nothing_leaves_the_drift_section_silent() {
        let (temp, _logs, summary) = scenario("로그인 리팩터링 해줘", "src/auth/login.ts");
        let report = build_report(&temp.repo, &temp.dir, &summary, None, IndexState::Idle);

        assert_eq!(
            report.drift.unavailable.expect("reason").reason,
            UnavailableReason::NoResolvableAnchor
        );
        assert!(report.drift.drifted_paths.is_empty());
        // The rest of the page is unaffected: silence in one section is not
        // silence in the report.
        assert!(!report.did.files.is_empty());
        assert!(report.went_through.never_ran_tests || report.went_through.test_runs > 0);
    }

    #[test]
    fn a_session_from_an_unrelated_directory_is_labelled_as_such() {
        let (temp, _logs, mut summary) =
            scenario("`src/auth/login.ts` 고쳐줘", "src/auth/login.ts");
        summary.cwd = "/somewhere/else/entirely".to_string();
        let report = build_report(&temp.repo, &temp.dir, &summary, None, IndexState::Idle);
        assert_eq!(report.header.cwd_relation, CwdRelation::Unrelated);
        assert!(
            report.did.attribution.is_none(),
            "an unrelated cwd is a hard refusal"
        );
    }

    #[test]
    fn a_truncated_log_marks_every_count_as_a_floor() {
        let (temp, _logs, mut summary) =
            scenario("`src/auth/login.ts` 고쳐줘", "src/app.ts");
        summary.truncated = true;
        let report = build_report(&temp.repo, &temp.dir, &summary, None, IndexState::Idle);
        assert!(report.header.partial);
        assert!(report.header.truncated);
        assert_ne!(
            report.drift.verdict,
            DriftVerdict::FullDrift,
            "G7 forbids the strongest verdict on a partial observation"
        );
    }

    #[test]
    fn the_tracked_file_list_covers_head_and_the_index() {
        let temp = TempRepo::new();
        temp.commit("feat: seed", &[("src/a.ts", "1\n"), ("docs/b.md", "x\n")]);
        let files = tracked_files(&temp.repo);
        assert!(files.contains("src/a.ts"));
        assert!(files.contains("docs/b.md"));
    }

    #[test]
    fn a_digest_hides_a_low_confidence_link_entirely() {
        let summary = testutil::session_with(&["/repo/a.rs"], &[]);
        let link = testutil::link_for(&["abc"], LinkConfidence::Low);
        let digest = digest_for(&summary, Some(&link));
        assert!(digest.commit_ids.is_empty());
        assert!(digest.attribution.is_none());
        assert_eq!(digest.files_edited_count, 1);
    }

    #[test]
    fn digests_come_back_newest_first() {
        let temp = TempRepo::new();
        temp.commit("feat: seed", &[("src/a.ts", "1\n")]);

        let mut older = testutil::session_with(&["/repo/a.rs"], &[]);
        older.session_id = "older".into();
        older.file_path = "/logs/older.jsonl".into();
        older.ended_at = 1_000;
        let mut newer = testutil::session_with(&["/repo/b.rs"], &[]);
        newer.session_id = "newer".into();
        newer.file_path = "/logs/newer.jsonl".into();
        newer.ended_at = 9_000;

        let digests = digests_for(&temp.repo, &temp.dir, &[older, newer]);
        let order: Vec<&str> = digests.iter().map(|d| d.session_id.as_str()).collect();
        assert_eq!(order, vec!["newer", "older"]);
    }

    #[test]
    fn a_session_that_changed_somewhere_else_entirely_is_reported_as_full_drift() {
        // The prompt names `login.ts`; the session only ever touched `app.ts`,
        // and no commit in the window can be tied to it. This is the failure
        // the whole section exists for: the agent understood the request and
        // then worked somewhere else.
        let (temp, _logs, summary) = scenario("`src/auth/login.ts` 만 고쳐줘", "src/app.ts");
        let report = build_report(&temp.repo, &temp.dir, &summary, None, IndexState::Idle);

        assert!(
            report.did.attribution.is_none(),
            "zero file overlap must not be attributed"
        );
        assert_eq!(report.drift.basis, ImpactBasis::WorktreeFallback);
        assert_eq!(report.drift.verdict, DriftVerdict::FullDrift);
        assert!(report
            .drift
            .drifted_paths
            .iter()
            .any(|path| path.path == "src/app.ts"));
        assert_eq!(
            report.drift.confidence,
            LinkConfidence::Low,
            "a worktree baseline is never stated as fact"
        );
    }
}

/// Smoke test against the user's real session logs. Ignored by default — it
/// depends on `~/.claude` and on which repository this checkout is. Run with
/// `cargo test -- --ignored --nocapture real_session` while developing V26:
/// fixtures prove the guards, only real prompts prove the extractors.
#[cfg(test)]
mod real_sessions {
    use super::*;
    use crate::verify::session::{summarize_sessions_for_repo, SessionRoots};
    use std::path::PathBuf;

    #[test]
    #[ignore]
    fn real_session_reports_are_honest_about_scope() {
        let here = std::env::current_dir().expect("cwd");
        let root = here.parent().expect("worktree root").to_path_buf();
        let Ok(repo) = Repository::open(&root) else {
            eprintln!("no repository at {}", root.display());
            return;
        };

        // Agents run from the worktree root *and* from subdirectories, and each
        // cwd gets its own Claude project directory. `GITBARO_REPORT_SESSIONS`
        // overrides which cwd's logs are read, so a checkout with no history of
        // its own can still be exercised against real prompts.
        let discovery: Vec<PathBuf> = match std::env::var("GITBARO_REPORT_SESSIONS") {
            Ok(path) => vec![PathBuf::from(path)],
            Err(_) => vec![root.clone(), here],
        };
        let summaries: Vec<SessionSummary> = discovery
            .iter()
            .flat_map(|cwd| {
                summarize_sessions_for_repo(cwd, &SessionRoots::from_home(), None, Some(6))
            })
            .collect();
        println!("== {} real session(s) under {}", summaries.len(), root.display());

        for summary in &summaries {
            let report = build_report(&repo, &root, summary, None, IndexState::Idle);
            println!(
                "\n-- {}\n   {} prompt(s) · {} file(s) · {} commit(s) · {:?}",
                report.header.title,
                report.asked.total_prompts,
                report.did.files_edited_count,
                report.did.commits.len(),
                report.header.cwd_relation,
            );
            println!(
                "   drift {:?} conf={:?} unavailable={:?}",
                report.drift.verdict,
                report.drift.confidence,
                report.drift.unavailable.as_ref().map(|u| u.reason),
            );
            for mention in report.drift.mentions.iter().take(15) {
                println!(
                    "     {:?} {:?} -> {:?}",
                    mention.extractor,
                    mention.raw,
                    mention.resolved.as_ref().map(|anchor| &anchor.path),
                );
            }
            for path in report.drift.drifted_paths.iter().take(5) {
                println!("     drifted: {}", path.path);
            }
        }
    }
}
