//! Shared serialization types for the `verify` subsystem (contract §2).
//!
//! Every type that crosses the Rust ↔ TypeScript boundary lives here, and only
//! here. The rule modules (`rules/`, `deps/`, `session/`, `review/`,
//! `evidence/`, `hygiene/`) treat this file as read-only.
//!
//! **Time unit**: every timestamp in this subsystem is epoch *milliseconds*
//! (`chrono::Utc::now().timestamp_millis()`). `git::engine::CommitInfo::timestamp`
//! is in *seconds*, so callers multiply by 1000 at the boundary.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use super::registry;

// ── Severity & rule kinds ────────────────────────────────────────────────────

/// Declared low → high. Sort with `Ord`, then display in reverse.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Info,
    Warn,
    Danger,
}

/// One variant per implemented rule. Serialized camelCase into a TS union.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum FindingKind {
    // ── V1: structural diff ──────────────────────────────────────────────
    StructuralDiff,
    // ── V2: test disabling ───────────────────────────────────────────────
    TestSkipAdded,
    TestFileDeleted,
    AssertionRemoved,
    // ── V3: test quality anti-patterns ───────────────────────────────────
    VacuousAssertion,
    MockOnlyAssertion,
    NoAssertionTest,
    BroadExceptionAssertion,
    AssertionRoulette,
    // ── V4: hallucinated dependencies ────────────────────────────────────
    HallucinatedDependency,
    SuspiciousNewDependency,
    // ── V5: verification bypass traces (static) ──────────────────────────
    VerificationBypassed,
    TypeEscapeHatchAdded,
    EmptyCatchAdded,
    UnsafeUnwrapAdded,
    // ── V6: scope drift ──────────────────────────────────────────────────
    ScopeDrift,
    // ── V7 / V8 / V9: codebase context ───────────────────────────────────
    // Reinvention and reachability rules are inserted on the line below.
    ReinventedFunction,
    OrphanCode,
    BlastRadius,
    // ── V10: deletion classification ─────────────────────────────────────
    PublicExportDeleted,
    ErrorHandlingDeleted,
    ValidationDeleted,
    // ── V11 / V12: execution evidence ────────────────────────────────────
    TestEvidenceMissing,
    TestEvidenceStale,
    TestEvidenceFailed,
    UncoveredNewLines,
    // ── V17: invariant assertions ────────────────────────────────────────
    InvariantViolation,
    // ── V19~V27: session logs ────────────────────────────────────────────
    ReadLessEdit,
    TestFailureThenTestEdited,
    TestsNeverRunInSession,
    HookBypassCommand,
    UnrewindableChange,
    SubagentEdit,
    PostCompactionEdit,
    RepeatedEdit,
    PromptScopeDrift,
    StaleRulesInjected,
    // ── V31 / V32 / V35: commit hygiene ──────────────────────────────────
    TangledCommit,
    RevertUnsafe,
    AgentTrailerMismatch,
}

// ── Finding ──────────────────────────────────────────────────────────────────

/// A single piece of evidence. Built only through [`Finding::new`] so that
/// `severity` and `rule_id` can never drift from the registry.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub kind: FindingKind,
    pub severity: Severity,
    /// Repository-relative path. Commit- or session-level findings carry an
    /// empty string; the frontend renders those as "commit level".
    pub file: String,
    /// 1-based line number in the new file, when one can be pinpointed.
    pub line: Option<u32>,
    /// **Not translated.** A factual sentence carrying concrete evidence, e.g.
    /// `"it.skip added"`. Titles and descriptions are i18n'd from `rule_id`.
    pub message: String,
    /// Extra evidence (snippet, command). Truncated to 512 characters.
    pub detail: Option<String>,
    /// Stable wire identifier. Always `kind.rule_id()` — never a literal.
    pub rule_id: String,
}

/// `detail` is capped here so a runaway snippet cannot bloat a report.
const MAX_DETAIL_CHARS: usize = 512;

impl Finding {
    pub fn new(kind: FindingKind, file: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind,
            severity: kind.default_severity(),
            file: file.into(),
            line: None,
            message: message.into(),
            detail: None,
            rule_id: kind.rule_id().to_string(),
        }
    }

    pub fn at_line(mut self, line: u32) -> Self {
        self.line = Some(line);
        self
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        self.detail = Some(if detail.chars().count() > MAX_DETAIL_CHARS {
            detail.chars().take(MAX_DETAIL_CHARS).collect()
        } else {
            detail
        });
        self
    }

    /// Raise the severity. Never lowers it — an unjustified downgrade would
    /// hide a signal the registry decided was worth this level.
    pub fn escalate(mut self, severity: Severity) -> Self {
        if severity > self.severity {
            self.severity = severity;
        }
        self
    }

    pub fn is_file_scoped(&self) -> bool {
        !self.file.is_empty()
    }
}

impl FindingKind {
    /// `"<v-number lowercase>.<variant lowerCamel>"`. Anchors user settings,
    /// statistics and i18n keys — **never change a shipped id**.
    pub const fn rule_id(&self) -> &'static str {
        match self {
            // ── V1: structural diff ──────────────────────────────────────
            FindingKind::StructuralDiff => "v1.structuralDiff",
            FindingKind::TestSkipAdded => "v2.testSkipAdded",
            FindingKind::TestFileDeleted => "v2.testFileDeleted",
            FindingKind::AssertionRemoved => "v2.assertionRemoved",
            FindingKind::VacuousAssertion => "v3.vacuousAssertion",
            FindingKind::MockOnlyAssertion => "v3.mockOnlyAssertion",
            FindingKind::NoAssertionTest => "v3.noAssertionTest",
            FindingKind::BroadExceptionAssertion => "v3.broadExceptionAssertion",
            FindingKind::AssertionRoulette => "v3.assertionRoulette",
            FindingKind::HallucinatedDependency => "v4.hallucinatedDependency",
            FindingKind::SuspiciousNewDependency => "v4.suspiciousNewDependency",
            FindingKind::VerificationBypassed => "v5.verificationBypassed",
            FindingKind::TypeEscapeHatchAdded => "v5.typeEscapeHatchAdded",
            FindingKind::EmptyCatchAdded => "v5.emptyCatchAdded",
            FindingKind::UnsafeUnwrapAdded => "v5.unsafeUnwrapAdded",
            FindingKind::ScopeDrift => "v6.scopeDrift",
            // ── V7 / V8 / V9: codebase context ───────────────────────────
            // Reinvention and reachability arms go on the line below.
            FindingKind::ReinventedFunction => "v7.reinventedFunction",
            FindingKind::OrphanCode => "v8.orphanCode",
            FindingKind::BlastRadius => "v9.blastRadius",
            FindingKind::PublicExportDeleted => "v10.publicExportDeleted",
            FindingKind::ErrorHandlingDeleted => "v10.errorHandlingDeleted",
            FindingKind::ValidationDeleted => "v10.validationDeleted",
            FindingKind::TestEvidenceMissing => "v11.testEvidenceMissing",
            FindingKind::TestEvidenceStale => "v11.testEvidenceStale",
            FindingKind::TestEvidenceFailed => "v11.testEvidenceFailed",
            FindingKind::UncoveredNewLines => "v12.uncoveredNewLines",
            // ── V17: invariant assertions ────────────────────────────────
            FindingKind::InvariantViolation => "v17.invariantViolation",
            FindingKind::ReadLessEdit => "v19.readLessEdit",
            FindingKind::TestFailureThenTestEdited => "v20.testFailureThenTestEdited",
            FindingKind::TestsNeverRunInSession => "v20.testsNeverRunInSession",
            FindingKind::HookBypassCommand => "v21.hookBypassCommand",
            FindingKind::UnrewindableChange => "v22.unrewindableChange",
            FindingKind::SubagentEdit => "v23.subagentEdit",
            FindingKind::PostCompactionEdit => "v24.postCompactionEdit",
            FindingKind::RepeatedEdit => "v25.repeatedEdit",
            FindingKind::PromptScopeDrift => "v26.promptScopeDrift",
            FindingKind::StaleRulesInjected => "v27.staleRulesInjected",
            FindingKind::TangledCommit => "v31.tangledCommit",
            FindingKind::RevertUnsafe => "v32.revertUnsafe",
            FindingKind::AgentTrailerMismatch => "v35.agentTrailerMismatch",
        }
    }

    /// Looked up in the registry so the table stays the single source of truth.
    /// A missing entry is impossible (see `registry::tests`); `Warn` is the
    /// neutral fallback rather than a panic.
    pub fn default_severity(&self) -> Severity {
        registry::find(self.rule_id())
            .map(|entry| entry.default_severity)
            .unwrap_or(Severity::Warn)
    }
}

// ── VerificationReport ───────────────────────────────────────────────────────

/// The honesty contract (§7-①): findings alone never mean "safe". Every report
/// also states which rules ran and which did not, and why.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VerificationReport {
    pub findings: Vec<Finding>,
    /// Rules that actually ran against at least one target.
    pub checked: Vec<String>,
    /// Rules with at least one target they could not look at. Derived from
    /// `limits` — never filled in directly.
    pub unchecked: Vec<String>,
    /// Why each unchecked rule was skipped.
    pub limits: Vec<ScanLimit>,
    /// Epoch milliseconds.
    pub generated_at: i64,
}

impl VerificationReport {
    /// The only constructor. Derives `unchecked`, stamps `generated_at`, and
    /// sorts findings severity-descending → path ascending → line ascending.
    pub fn new(mut findings: Vec<Finding>, checked: Vec<String>, limits: Vec<ScanLimit>) -> Self {
        findings.sort_by(|a, b| {
            b.severity
                .cmp(&a.severity)
                .then_with(|| a.file.cmp(&b.file))
                .then_with(|| a.line.cmp(&b.line))
        });

        let unchecked: Vec<String> = limits
            .iter()
            .map(|limit| limit.rule_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();

        let checked: Vec<String> = checked
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();

        Self {
            findings,
            checked,
            unchecked,
            limits,
            generated_at: now_millis(),
        }
    }

    /// An empty report that still accounts for the whole registry.
    pub fn empty() -> Self {
        Self::new(Vec::new(), Vec::new(), Vec::new())
    }

    /// Highest severity present, or `None` when there are no findings.
    /// `None` does **not** mean "safe" — read `unchecked` alongside it.
    pub fn max_severity(&self) -> Option<Severity> {
        self.findings.iter().map(|f| f.severity).max()
    }

    pub fn count_of(&self, severity: Severity) -> usize {
        self.findings
            .iter()
            .filter(|f| f.severity == severity)
            .count()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanLimit {
    pub rule_id: String,
    pub reason: UncheckedReason,
    /// Concrete, human-readable cause, e.g. `"lcov.info not found"`.
    pub detail: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UncheckedReason {
    /// Turned off by the user (§7-②).
    Disabled,
    /// The diff contains no target of this rule's kind.
    NotApplicable,
    /// Outside the TS/JS/Rust language scope (§7-⑤).
    UnsupportedLanguage,
    /// A required artifact (lcov, lockfile, session log …) is absent.
    MissingArtifact,
    /// Parsing failed — a quiet non-check, not an error (§7-⑥).
    ParseFailed,
    /// A byte or time budget was exhausted (§7-⑦).
    BudgetExceeded,
    /// Registered but not implemented yet (V1, V7, V8, V9 …).
    NotImplemented,
}

// ── Rule descriptor (settings screen) ────────────────────────────────────────

/// Serializable form of `registry::RuleEntry`, including `Planned` rules so the
/// settings UI can show what is *not* being checked (§7-①).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuleDescriptor {
    pub rule_id: String,
    pub kind: Option<FindingKind>,
    pub v_number: String,
    pub layer: u8,
    pub default_severity: Severity,
    pub status: registry::RuleStatus,
    pub enabled: bool,
}

// ── Review state (V13 · V29 · V34 · V33) ─────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReviewStatus {
    Unreviewed,
    Reviewed,
    /// Content changed after review → automatically back to unreviewed (V13).
    /// Commits are immutable, so a commit can never be `Stale`.
    Stale,
}

/// The on-disk mark. `status` is computed on read, never stored.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileReviewMark {
    pub path: String,
    /// `digest::diff_hash` of the diff text at review time.
    pub reviewed_diff_hash: String,
    pub reviewed_at: i64,
    /// git `user.name <user.email>` — the attribution this feature exists for.
    pub reviewer: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileReviewEntry {
    pub path: String,
    pub status: ReviewStatus,
    pub reviewed_at: Option<i64>,
    pub reviewer: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitReviewState {
    pub commit_id: String,
    /// Only `Unreviewed` or `Reviewed`.
    pub status: ReviewStatus,
    pub reviewed_at: Option<i64>,
    pub reviewer: Option<String>,
}

/// V29 — the unreviewed-commit queue.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQueue {
    /// Newest first.
    pub unreviewed_commit_ids: Vec<String>,
    pub total_unreviewed: usize,
    /// Whether `unreviewed_commit_ids` was cut off by the limit.
    pub truncated: bool,
    pub last_reviewed_at: Option<i64>,
}

/// V34 — the pre-push gate. **Display only. It never blocks.**
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PushGateSummary {
    pub commits: Vec<PushGateCommit>,
    pub unreviewed_count: usize,
    pub danger_count: usize,
    pub warn_count: usize,
    /// Commits touching enough files that a clean revert is unlikely (V31).
    pub tangled_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PushGateCommit {
    pub commit_id: String,
    pub summary: String,
    pub review_status: ReviewStatus,
    pub files_changed: usize,
    /// Highest severity among findings. `None` when there are none (≠ safe).
    pub max_severity: Option<Severity>,
    pub finding_count: usize,
}

/// Lightweight badge summary for history lists — a full report per commit would
/// be far too heavy for a hundred rows.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitVerificationSummary {
    pub commit_id: String,
    pub max_severity: Option<Severity>,
    pub danger_count: usize,
    pub warn_count: usize,
    pub info_count: usize,
    /// Rules left unchecked for this commit (§7-① exposes this on the badge).
    pub unchecked_count: usize,
}

/// V33 — the git-notes evidence ledger. **Off by default, local only, never pushed.**
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceLedgerEntry {
    pub commit_id: String,
    pub recorded_at: i64,
    pub recorded_by: String,
    pub checks: Vec<LedgerCheck>,
    /// GitBaro version at record time — the format will evolve.
    pub tool_version: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LedgerCheck {
    pub rule_id: String,
    pub outcome: LedgerOutcome,
    pub finding_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LedgerOutcome {
    Passed,
    Flagged,
    Skipped,
}

// ── Execution evidence (V11 · V12) ───────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestEvidence {
    /// `digest::worktree_hash` result (40 hex characters).
    pub worktree_hash: String,
    /// Manifest used to diff the evidence against the tree. Emptied above 5000 lines.
    pub manifest: Vec<String>,
    pub command: String,
    pub exit_code: Option<i32>,
    pub passed: bool,
    pub ran_at: i64,
    pub duration_ms: u64,
    /// Last 8 KiB of stdout+stderr. May contain secrets — never re-logged.
    pub output_tail: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EvidenceFreshness {
    /// Recorded tree hash == current tree hash.
    Fresh,
    /// The tree moved, so the evidence expired.
    #[serde(rename_all = "camelCase")]
    Stale { changed_files: Option<usize> },
    /// No run has ever been recorded for this repository.
    Absent,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestEvidenceStatus {
    pub evidence: Option<TestEvidence>,
    pub freshness: EvidenceFreshness,
    pub current_worktree_hash: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffCoverage {
    pub path: String,
    pub added_lines: u32,
    pub covered_added_lines: u32,
    pub uncovered_added_lines: Vec<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoverageResult {
    /// Repository-relative path of the parsed report.
    pub source: String,
    pub parsed_at: i64,
    pub files: Vec<DiffCoverage>,
    /// Changed files absent from the report, so undecidable (§7-① honesty).
    pub unmapped_files: Vec<String>,
}

// ── Session types (V19~V27 · V30) ────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionSource {
    ClaudeCode,
    Codex,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_id: String,
    pub source: SessionSource,
    /// Absolute path of the session JSONL (the re-lookup key).
    pub file_path: String,
    pub cwd: String,
    pub git_branch: Option<String>,
    pub started_at: i64,
    pub ended_at: i64,
    /// Session-file mtime in epoch milliseconds. A hard gate in correlation: a
    /// log that stopped growing long before a commit cannot explain it.
    /// `0` means "unknown" and is treated as neutral, never as evidence.
    #[serde(default)]
    pub modified_at: i64,
    /// V26 — the specification anchor. Truncated at 2000 chars. Stays local.
    pub first_user_prompt: Option<String>,
    /// Every human prompt, in time order. `first_user_prompt` is equivalent to
    /// `prompts.first()` and is kept for cache and caller compatibility.
    /// Capped at [`MAX_SESSION_PROMPTS`]; a session with more instructions than
    /// that is already beyond what any report can usefully quote.
    #[serde(default)]
    pub prompts: Vec<PromptRecord>,
    pub files_read: Vec<String>,
    pub files_edited: Vec<FileEditSummary>,
    pub bash_commands: Vec<BashCommandRecord>,
    /// V24 — `compact_boundary` timestamps.
    pub compaction_boundaries: Vec<i64>,
    /// V27 — digest of injected CLAUDE.md/AGENTS.md content (body not stored).
    pub injected_rules_digest: Option<String>,
    /// The tail could not be read within budget (§7-⑦). Every derived signal is
    /// then a *partial* observation.
    pub truncated: bool,
    /// Records skipped (over-long lines, parse failures). Non-zero ⇒ partial.
    pub skipped_records: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileEditSummary {
    pub path: String,
    /// V25 — re-edit count (a floundering indicator).
    pub edit_count: u32,
    pub first_edit_at: i64,
    pub last_edit_at: i64,
    /// V19 — was it Read/Grep'd in this session before the first edit?
    pub was_read_first: bool,
    /// V24 — edited after a compaction boundary?
    pub after_compaction: bool,
    /// V23 — edited by an `isSidechain` subagent?
    pub by_subagent: bool,
    /// V22 — changed through Bash (= outside `/rewind`'s restore scope)?
    pub via_bash: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BashCommandRecord {
    /// Truncated at 512 chars.
    pub command: String,
    pub at: i64,
    pub is_error: bool,
    pub kind: BashCommandKind,
    /// Verbatim bypass tokens found in the command (`--no-verify`, `SKIP=` …).
    /// The evidence a report quotes instead of paraphrasing.
    #[serde(default)]
    pub bypass_markers: Vec<String>,
}

/// One human instruction. Ordinal `0` is the specification anchor; the rest are
/// corrections. The text is quoted verbatim — never translated or summarised.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PromptRecord {
    pub at: i64,
    /// Truncated at `session::jsonl::MAX_PROMPT_CHARS`.
    pub text: String,
    pub truncated: bool,
    /// 0-based position among the session's human prompts.
    pub ordinal: u32,
    /// A compaction happened *after* this prompt, so the instruction may have
    /// dropped out of the agent's context. The only judgement this type makes.
    pub compacted_away: bool,
}

/// Upper bound on retained prompts per session.
pub const MAX_SESSION_PROMPTS: usize = 200;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BashCommandKind {
    /// pnpm test / vitest / jest / cargo test / pytest …
    TestRun,
    /// --no-verify / -n / SKIP= / push -f / chmod / rm -rf
    HookBypass,
    /// `>` / `>>` / `sed -i` / `mv` / `rm` (V22 — the rewind blind spot)
    FileMutation,
    Other,
}

/// V30 — session ↔ commit correlation. §7-⑧: misattribution is worse than none.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionCommitLink {
    pub session_id: String,
    pub session_path: String,
    /// Commits this session is credited with. Candidates graded `Low` are
    /// **removed** here and explained in `rejected` — a bad candidate must not
    /// drag the grade down while staying in the list.
    pub commit_ids: Vec<String>,
    /// The **best** grade among `commits`, never the weakest.
    pub confidence: LinkConfidence,
    /// Evidence tokens, union over `commits`. See [`BASIS_TOKENS`].
    pub basis: Vec<String>,
    /// Per-commit verdicts, same order as `commit_ids`.
    pub commits: Vec<CommitLinkDetail>,
    /// Candidates that were considered and dropped, with the reason.
    pub rejected: Vec<RejectedCommit>,
    /// How many sessions claimed the same commit equally strongly. `0` when
    /// this link was uncontested.
    pub ambiguous_with: usize,
}

/// The complete set of evidence tokens correlation may emit. The frontend
/// renders nothing outside this list.
pub const BASIS_TOKENS: &[&str] = &[
    "cwd",
    "branch",
    "timeWindow",
    "fileOverlap",
    "mtime",
    "author",
    "reflog",
    "siblingWorktree",
];

/// One (session, commit) verdict.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitLinkDetail {
    pub commit_id: String,
    pub confidence: LinkConfidence,
    pub basis: Vec<String>,
    /// `|session edits ∩ commit changes| / |commit changes|`.
    pub commit_coverage: f32,
    /// `|session edits ∩ commit changes| / |session edits|`.
    pub session_coverage: f32,
    /// Files in the commit the session never edited — the visible reason a
    /// grade stopped at `Medium`. Capped at [`MAX_UNATTRIBUTED_FILES`].
    pub unattributed_files: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RejectedCommit {
    pub commit_id: String,
    pub reason: RejectionReason,
}

/// Why a candidate commit was not attributed to a session.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RejectionReason {
    MergeCommit,
    BranchMismatch,
    NoFileOverlap,
    OutsideSessionWindow,
    DifferentWorktree,
    DifferentAuthor,
    /// Another session claimed it as strongly or more strongly.
    AmbiguousWithAnotherSession,
    /// A partially observed log cannot support a partial-coverage claim.
    PartialLogInsufficient,
}

/// Where a session's working directory sits relative to the repository being
/// viewed.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CwdRelation {
    /// The session cwd is this worktree, or a directory inside it.
    ThisWorktree,
    /// A different worktree sharing this repository's object database.
    /// Attribution caps at `Medium`.
    SiblingWorktree,
    /// Nothing to do with this repository.
    Unrelated,
}

/// `unattributed_files` cap — enough to explain a Medium, not a file listing.
pub const MAX_UNATTRIBUTED_FILES: usize = 20;

/// `rejected` cap — the near-misses worth explaining, not the whole walk.
pub const MAX_REJECTED_COMMITS: usize = 20;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum LinkConfidence {
    Low,
    Medium,
    High,
}

/// Epoch milliseconds — the single time unit of this subsystem.
pub fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limit(rule_id: &str, reason: UncheckedReason) -> ScanLimit {
        ScanLimit {
            rule_id: rule_id.to_string(),
            reason,
            detail: None,
        }
    }

    #[test]
    fn finding_takes_severity_and_rule_id_from_the_registry() {
        let finding = Finding::new(FindingKind::TestFileDeleted, "a.test.ts", "deleted");
        assert_eq!(finding.rule_id, "v2.testFileDeleted");
        assert_eq!(finding.severity, Severity::Danger);
        assert!(finding.is_file_scoped());
    }

    #[test]
    fn commit_level_findings_are_not_file_scoped() {
        let finding = Finding::new(FindingKind::TangledCommit, "", "18 files");
        assert!(!finding.is_file_scoped());
    }

    #[test]
    fn escalate_raises_but_never_lowers() {
        let raised = Finding::new(FindingKind::ScopeDrift, "a.ts", "m").escalate(Severity::Danger);
        assert_eq!(raised.severity, Severity::Danger);
        let kept = Finding::new(FindingKind::TestFileDeleted, "a.ts", "m").escalate(Severity::Info);
        assert_eq!(kept.severity, Severity::Danger);
    }

    #[test]
    fn detail_is_truncated_to_512_chars() {
        let finding =
            Finding::new(FindingKind::ScopeDrift, "a.ts", "m").with_detail("x".repeat(900));
        assert_eq!(finding.detail.expect("detail").chars().count(), 512);
    }

    #[test]
    fn report_derives_unchecked_from_limits_sorted_and_deduplicated() {
        let report = VerificationReport::new(
            Vec::new(),
            vec!["v2.testSkipAdded".to_string()],
            vec![
                limit("v6.scopeDrift", UncheckedReason::Disabled),
                limit("v3.vacuousAssertion", UncheckedReason::Disabled),
                limit("v6.scopeDrift", UncheckedReason::NotApplicable),
            ],
        );
        assert_eq!(
            report.unchecked,
            vec!["v3.vacuousAssertion", "v6.scopeDrift"]
        );
    }

    #[test]
    fn report_sorts_findings_by_severity_then_path_then_line() {
        let report = VerificationReport::new(
            vec![
                Finding::new(FindingKind::PublicExportDeleted, "b.ts", "info"),
                Finding::new(FindingKind::TestFileDeleted, "z.ts", "danger"),
                Finding::new(FindingKind::ScopeDrift, "a.ts", "warn").at_line(9),
                Finding::new(FindingKind::ScopeDrift, "a.ts", "warn").at_line(2),
            ],
            Vec::new(),
            Vec::new(),
        );
        let order: Vec<&str> = report.findings.iter().map(|f| f.message.as_str()).collect();
        assert_eq!(order, vec!["danger", "warn", "warn", "info"]);
        assert_eq!(report.findings[1].line, Some(2));
    }

    #[test]
    fn max_severity_is_none_without_findings() {
        assert!(VerificationReport::empty().max_severity().is_none());
    }
}
