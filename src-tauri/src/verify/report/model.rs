//! Every type the session report puts on the wire (session-report §3).
//!
//! This file is the **sole owner** of the report vocabulary. The section
//! builders next to it produce these structs and nothing else; the frontend
//! mirrors them one-for-one.
//!
//! Two conventions carry through all of it:
//!
//! * **Provenance is part of the answer.** A fact read out of the session log
//!   and a fact derived from a heuristic correlation are not the same claim, so
//!   they are labelled differently rather than blended.
//! * **A section that cannot answer says why.** `unavailable: Some(_)` means the
//!   body fields are empty *on purpose*; the UI omits the section instead of
//!   rendering an empty box that reads as "nothing to report".

use serde::{Deserialize, Serialize};

use crate::verify::context::{BlastRadiusEntry, IndexState};
use crate::verify::types::{LinkConfidence, SessionSource, Severity};

// Owned by `verify/types.rs` because correlation produces them too. Re-exported
// here so the report has one import surface.
pub use crate::verify::types::{CwdRelation, PromptRecord, RejectedCommit, RejectionReason};

// ── Shared vocabulary (§3.3) ─────────────────────────────────────────────────

/// Where an item came from. The UI tunes how plainly it states a line by this.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Provenance {
    /// Written verbatim in the agent's session log. The strongest evidence.
    SessionLog,
    /// Read straight out of a git object. Fact.
    Git,
    /// The tree-sitter symbol index resolved it by name. May be incomplete.
    SymbolIndex,
    /// Computed from two or more of the above, so it inherits the weakest of
    /// their confidences.
    Derived,
}

/// Why a whole section cannot answer its question.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Unavailable {
    pub reason: UnavailableReason,
    /// Concrete, human-readable cause. **Not translated** — a factual sentence,
    /// e.g. `"symbol index is partial (412 of 5100 file(s) indexed)"`.
    pub detail: Option<String>,
}

impl Unavailable {
    pub fn new(reason: UnavailableReason) -> Self {
        Self {
            reason,
            detail: None,
        }
    }

    pub fn with_detail(reason: UnavailableReason, detail: impl Into<String>) -> Self {
        Self {
            reason,
            detail: Some(detail.into()),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UnavailableReason {
    /// The session log holds no user prompt at all.
    NoPrompt,
    /// No mention in any prompt resolved to something in this repository (V26 G1).
    NoResolvableAnchor,
    /// No commit was tied to this session strongly enough to name it.
    NoCommitAttribution,
    /// This repository has no symbol index. The UI may offer to build one.
    NoSymbolIndex,
    /// The index is partial — treated as **identical to absent**, never as
    /// "we looked and found nothing".
    PartialSymbolIndex,
    /// This agent's log never carries the data (Codex: reads, sidechains,
    /// compaction).
    UnsupportedAgent,
    /// A parse or assembly budget ran out before this section was filled.
    ParseBudget,
    /// Nothing to answer — e.g. no signature changed at all.
    NotApplicable,
}

// ── Header (§3.4) ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReportHeader {
    pub session_id: String,
    pub session_path: String,
    pub source: SessionSource,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
    pub cwd: String,
    pub git_branch: Option<String>,
    /// One-line title, **composed by the backend** so the UI never assembles
    /// one: first prompt's first line (80 chars) → branch → short session id.
    pub title: String,
    pub cwd_relation: CwdRelation,
    /// `truncated || skipped_records > 0`. When true **every count in this
    /// report is a floor, not a total.**
    pub partial: bool,
    pub truncated: bool,
    pub skipped_records: usize,
    pub compaction_count: usize,
}

// ── § What was asked (§3.5) ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AskedSection {
    pub unavailable: Option<Unavailable>,
    /// Ascending by time, capped at [`super::MAX_REPORT_PROMPTS`].
    pub prompts: Vec<PromptRecord>,
    /// Total observed, so the UI can say the list was cut.
    pub total_prompts: usize,
}

// ── § What was done (§3.6) ───────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DidSection {
    /// Only ever the *commit* half. File edits come from the log, so this
    /// section is never wholly empty when the session edited anything.
    pub unavailable: Option<Unavailable>,
    /// Empty when attribution was refused or graded `Low`.
    pub commits: Vec<ReportCommit>,
    pub attribution: Option<CommitAttribution>,
    /// Repository-relative. Sorted churn-descending, then path-ascending.
    pub files: Vec<TouchedFile>,
    pub files_edited_count: usize,
    pub files_read_count: usize,
    /// Edited in the session but in none of the attributed commits = work not
    /// committed yet. Empty when there is no attribution (we do not then claim
    /// everything is uncommitted).
    pub uncommitted_paths: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReportCommit {
    pub commit_id: String,
    pub summary: String,
    pub author_name: String,
    /// Epoch **milliseconds**.
    pub committed_at: i64,
    pub files_changed: usize,
    pub insertions: usize,
    pub deletions: usize,
    /// In this commit but never edited in the session — the visible reason a
    /// grade is `Medium` rather than `High`.
    pub unattributed_files: Vec<String>,
    pub confidence: LinkConfidence,
    pub provenance: Provenance,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitAttribution {
    /// The **best** grade among the attributed commits.
    pub confidence: LinkConfidence,
    /// Evidence tokens: `"cwd"` `"branch"` `"timeWindow"` `"fileOverlap"`
    /// `"mtime"` `"author"` `"reflog"` `"siblingWorktree"`.
    pub basis: Vec<String>,
    /// Candidates that were dropped, and why. This is the honesty half.
    pub rejected: Vec<RejectedCommit>,
    /// How many sessions claimed the same commit equally strongly.
    pub ambiguous_with: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TouchedFile {
    /// **Repository-relative.** Session logs record absolute paths; they are
    /// normalised here.
    pub path: String,
    /// V25 churn — where the agent floundered. The star of this section.
    pub edit_count: u32,
    pub was_read_first: bool,
    pub by_subagent: bool,
    pub via_bash: bool,
    pub after_compaction: bool,
    pub first_edit_at: i64,
    pub last_edit_at: i64,
    /// Line counts from the attributed commits; `None` without attribution.
    pub added_lines: Option<u32>,
    pub removed_lines: Option<u32>,
    pub in_commit: bool,
    pub is_test: bool,
    pub provenance: Provenance,
}

// ── § What it went through (§3.7) ────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WentThroughSection {
    pub unavailable: Option<Unavailable>,
    pub bash_total: usize,
    pub test_runs: usize,
    pub failed_test_runs: usize,
    /// Ascending by time, capped at [`super::MAX_REPORT_EVENTS`].
    /// **`Other` bash never enters here** — 120 `ls` calls are not a story.
    pub events: Vec<OrdealEvent>,
    /// Promoted out of the stream because it is the single most
    /// action-changing line on the page.
    pub test_edits_after_failure: Vec<TestEditAfterFailure>,
    /// Code changed and the suite never ran once (V20).
    pub never_ran_tests: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OrdealEvent {
    pub at: i64,
    pub kind: OrdealKind,
    /// Raw command or path, capped at [`super::MAX_EVIDENCE_CHARS`].
    /// **Never translated.**
    pub evidence: String,
    /// Bypass tokens, mutated paths, and other supporting evidence.
    pub detail: Option<String>,
    pub severity: Severity,
    pub provenance: Provenance,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OrdealKind {
    TestPassed,
    TestFailed,
    /// `--no-verify`, `SKIP=`, `push -f`, `chmod` … (`session::bash`).
    HookBypass,
    /// Shell redirect / `sed -i` / `rm` — outside checkpoint restore (V22).
    ShellMutation,
    /// Context compaction (V24).
    Compaction,
    /// Edit made inside a subagent sidechain (V23).
    SubagentEdit,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestEditAfterFailure {
    pub test_path: String,
    /// Failures observed **before** this edit. At or above
    /// `session::rules::TEST_FAILURE_THRESHOLD`.
    pub failures_before: usize,
    /// The failing command lines, at most [`super::MAX_FAILING_COMMANDS`].
    pub failing_commands: Vec<String>,
    pub edited_at: i64,
}

// ── § What is affected (§3.8) ────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImpactSection {
    /// `NoSymbolIndex` / `PartialSymbolIndex` / `NotApplicable` / `ParseBudget`.
    pub unavailable: Option<Unavailable>,
    /// `BlastRadiusEntry` is reused verbatim — no parallel type. Only entries
    /// with `untouched_caller_count > 0`: a signature change whose callers were
    /// all updated has nothing to say.
    pub entries: Vec<BlastRadiusEntry>,
    pub total_untouched_callers: usize,
    /// Exposed so the UI can offer "build it now" inside a page that already exists.
    pub index_state: IndexState,
    pub basis: ImpactBasis,
    pub provenance: Provenance,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImpactBasis {
    /// Oldest attributed commit's first parent → newest attributed commit.
    AttributedCommitRange,
    /// No attribution, so HEAD ↔ working tree narrowed to the session's edited
    /// paths. Later unrelated edits can leak in — the UI must say so.
    WorktreeFallback,
}

// ── § What differs from what was asked (§3.9) ────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DriftSection {
    /// `NoPrompt` / `NoResolvableAnchor` / `NotApplicable`. **Zero resolved
    /// anchors ends the section here — drift is never reported (G1).**
    pub unavailable: Option<Unavailable>,
    /// Every extracted mention, resolved or not.
    pub mentions: Vec<PromptMention>,
    pub in_scope_paths: Vec<String>,
    /// Changed where the prompt did not point. Churn-descending, capped at
    /// [`super::MAX_DRIFT_PATHS`].
    pub drifted_paths: Vec<DriftedPath>,
    pub drifted_total: usize,
    pub changed_total: usize,
    pub verdict: DriftVerdict,
    pub confidence: LinkConfidence,
    pub basis: ImpactBasis,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PromptMention {
    /// The token as written in the prompt. Quoted verbatim.
    pub raw: String,
    pub extractor: MentionExtractor,
    /// `None` = unresolved. An unresolved mention is **displayed but never
    /// narrows scope** (G4).
    pub resolved: Option<ResolvedAnchor>,
    pub prompt_ordinal: u32,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum MentionExtractor {
    /// CamelCase / snake_case identifier. Needs a symbol index.
    Identifier,
    /// Token carrying a known source extension (`utils.ts`).
    Extension,
    /// Token carrying a path separator (`src/verify`, `@/api/commands`).
    PathLike,
    /// Inside backticks. The strongest signal, so it sorts last (= highest).
    Backtick,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAnchor {
    /// Repository-relative. Directories carry a trailing `/`.
    pub path: String,
    pub kind: AnchorKind,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnchorKind {
    File,
    Directory,
    /// Resolved through the one file that uniquely defines this symbol.
    SymbolDefinition,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DriftedPath {
    pub path: String,
    pub edit_count: u32,
    pub added_lines: Option<u32>,
    pub removed_lines: Option<u32>,
    pub is_test: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DriftVerdict {
    /// Zero anchors — the section is not rendered; ships with `unavailable`.
    NoAnchor,
    /// Everything changed inside what the prompt named.
    WithinScope,
    /// Some inside, some outside.
    PartialDrift,
    /// Anchors resolved and **none** of those paths changed. The most valuable
    /// verdict on the page: the agent worked somewhere else.
    FullDrift,
}

// ── Top level (§3.2) ─────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionReport {
    pub header: ReportHeader,
    /// § What was asked
    pub asked: AskedSection,
    /// § What was done
    pub did: DidSection,
    /// § What it went through
    pub went_through: WentThroughSection,
    /// § What is affected
    pub impact: ImpactSection,
    /// § What differs from what was asked
    pub drift: DriftSection,
    /// Epoch milliseconds.
    pub generated_at: i64,
}

/// The list row — and the **only** data source for the "is there anything to
/// show at all?" gate (session-report §6.5).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionDigest {
    pub session_id: String,
    pub session_path: String,
    pub source: SessionSource,
    /// Same rule as [`ReportHeader::title`].
    pub title: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
    pub git_branch: Option<String>,
    pub files_edited_count: usize,
    /// Only `High`/`Medium` attributions. Empty when attribution was refused.
    pub commit_ids: Vec<String>,
    pub attribution: Option<LinkConfidence>,
    pub partial: bool,
}
