// Tauri wrappers for the `verify` subsystem (26 commands). Split out of
// commands.ts on size grounds and re-exported from there, so components can
// import from either "@/api/commands" or "@/api/verify".
//
// The Rust command name stays snake_case; only the arguments are camelCase.
// Optional Rust params are sent as explicit `null` rather than omitted.

import { invoke } from "@tauri-apps/api/core";
import type {
  VerificationReport,
  CommitVerificationSummary,
  RuleDescriptor,
  FileReviewEntry,
  CommitReviewState,
  ReviewQueue,
  PushGateSummary,
  EvidenceLedgerEntry,
  SessionSummary,
  SessionCommitLink,
  SessionDiff,
  TestEvidence,
  TestEvidenceStatus,
  CoverageResult,
  StructuralOutcome,
  SymbolIndexStatus,
  HookStatus,
  HookPreview,
  HookChange,
} from "@/types";

// Static scan & rule configuration (commands/verify.rs)

/**
 * Static diff rules over the working tree. Execution evidence (V11) and
 * coverage (V12) are reported as `unchecked` here — they have their own
 * commands.
 */
export async function verifyWorkingTree(
  repoPath: string,
  staged: boolean,
  draftMessage?: string | null,
): Promise<VerificationReport> {
  return invoke("verify_working_tree", {
    repoPath,
    staged,
    draftMessage: draftMessage ?? null,
  });
}

/** Full per-commit report: static diff rules plus commit hygiene (V31·V32·V35). */
export async function verifyCommit(repoPath: string, oid: string): Promise<VerificationReport> {
  return invoke("verify_commit", { repoPath, oid });
}

/** Lightweight batch for history badges. The backend caps the batch at 100 commits. */
export async function verifyCommitRange(
  repoPath: string,
  oids: string[],
): Promise<CommitVerificationSummary[]> {
  return invoke("verify_commit_range", { repoPath, oids });
}

/** Every registry rule, planned ones included, so settings can show what is not checked. */
export async function getVerifyRules(): Promise<RuleDescriptor[]> {
  return invoke("get_verify_rules");
}

export async function setVerifyRuleEnabled(ruleId: string, enabled: boolean): Promise<void> {
  return invoke("set_verify_rule_enabled", { ruleId, enabled });
}

/** V4. With `allowRegistry === false` (the default) nothing leaves the machine. */
export async function checkDependencies(
  repoPath: string,
  oid: string | null,
  allowRegistry: boolean,
): Promise<VerificationReport> {
  return invoke("check_dependencies", { repoPath, oid: oid ?? null, allowRegistry });
}

// Review state, push gate & evidence ledger (commands/review.rs)

export async function getFileReviewStates(
  repoPath: string,
  paths: string[],
  staged: boolean,
): Promise<FileReviewEntry[]> {
  return invoke("get_file_review_states", { repoPath, paths, staged });
}

/** The diff hash is computed by the backend — never send one from here. */
export async function markFileReviewed(
  repoPath: string,
  path: string,
  staged: boolean,
): Promise<FileReviewEntry> {
  return invoke("mark_file_reviewed", { repoPath, path, staged });
}

export async function unmarkFileReviewed(repoPath: string, path: string): Promise<void> {
  return invoke("unmark_file_reviewed", { repoPath, path });
}

export async function getCommitReviewStates(
  repoPath: string,
  oids: string[],
): Promise<CommitReviewState[]> {
  return invoke("get_commit_review_states", { repoPath, oids });
}

export async function markCommitReviewed(
  repoPath: string,
  oid: string,
): Promise<CommitReviewState> {
  return invoke("mark_commit_reviewed", { repoPath, oid });
}

export async function unmarkCommitReviewed(repoPath: string, oid: string): Promise<void> {
  return invoke("unmark_commit_reviewed", { repoPath, oid });
}

/** V29 — the unreviewed-commit queue, newest first. */
export async function getReviewQueue(
  repoPath: string,
  limit?: number | null,
): Promise<ReviewQueue> {
  return invoke("get_review_queue", { repoPath, limit: limit ?? null });
}

/** V34 — summarises the commits that would be pushed. **Display only; never blocks.** */
export async function getPushGateSummary(
  repoPath: string,
  remote: string,
  branch: string,
): Promise<PushGateSummary> {
  return invoke("get_push_gate_summary", { repoPath, remote, branch });
}

export async function getLedgerEnabled(repoPath: string): Promise<boolean> {
  return invoke("get_ledger_enabled", { repoPath });
}

export async function setLedgerEnabled(repoPath: string, enabled: boolean): Promise<void> {
  return invoke("set_ledger_enabled", { repoPath, enabled });
}

/** V33 — a commit with no note resolves to `null`, not an error. */
export async function readEvidenceLedger(
  repoPath: string,
  oid: string,
): Promise<EvidenceLedgerEntry | null> {
  return invoke("read_evidence_ledger", { repoPath, oid });
}

/** V33 — the backend recomputes the report and writes the note. Local only. */
export async function recordEvidenceLedger(
  repoPath: string,
  oid: string,
): Promise<EvidenceLedgerEntry> {
  return invoke("record_evidence_ledger", { repoPath, oid });
}

// Session logs (commands/session.rs)

/** Returns an empty list when no agent CLI has ever run here — not an error. */
export async function listSessionsForRepo(
  repoPath: string,
  limit?: number | null,
): Promise<SessionSummary[]> {
  return invoke("list_sessions_for_repo", { repoPath, limit: limit ?? null });
}

/** `null` when the file holds nothing recognisable. Throws only if it cannot be opened. */
export async function getSessionSummary(sessionPath: string): Promise<SessionSummary | null> {
  return invoke("get_session_summary", { sessionPath });
}

/** V19~V27 findings for one session. */
export async function verifySession(
  repoPath: string,
  sessionPath: string,
): Promise<VerificationReport> {
  return invoke("verify_session", { repoPath, sessionPath });
}

/** V30 — which sessions plausibly produced these commits. Always carries a confidence. */
export async function correlateSessionsToCommits(
  repoPath: string,
  oids: string[],
): Promise<SessionCommitLink[]> {
  return invoke("correlate_sessions_to_commits", { repoPath, oids });
}

/** V30 — everything a session changed, as one diff. Empty when no commit correlates. */
export async function getSessionCumulativeDiff(
  repoPath: string,
  sessionPath: string,
): Promise<SessionDiff> {
  return invoke("get_session_cumulative_diff", { repoPath, sessionPath });
}

// Execution evidence (commands/evidence.rs)

/** V11 — recorded evidence plus its freshness against the tree right now. */
export async function getTestEvidence(repoPath: string): Promise<TestEvidenceStatus> {
  return invoke("get_test_evidence", { repoPath });
}

/**
 * V11 — run the tests and bind the result to the current worktree hash.
 * A failing suite resolves with `passed: false`; a failure is evidence too.
 * Streams `verify:test-progress` events while it runs.
 *
 * `command` must come from user settings only — never from agent-produced text.
 */
export async function runTestCommand(repoPath: string, command: string): Promise<TestEvidence> {
  return invoke("run_test_command", { repoPath, command });
}

/** V12 — coverage of added lines. A missing report yields `unmappedFiles`, not an error. */
export async function getDiffCoverage(
  repoPath: string,
  oid?: string | null,
  coveragePath?: string | null,
): Promise<CoverageResult> {
  return invoke("get_diff_coverage", {
    repoPath,
    oid: oid ?? null,
    coveragePath: coveragePath ?? null,
  });
}

// Tree-sitter scans & symbol index (commands/syntax.rs)

/**
 * V1 — the structural comparison of one file. `oid === null` compares the
 * working tree.
 *
 * A `degraded` outcome is a normal answer, not an error: the caller keeps the
 * text diff and must not imply the file was analysed.
 */
export async function getStructuralDiff(
  repoPath: string,
  oid: string | null,
  path: string,
  staged: boolean,
): Promise<StructuralOutcome> {
  return invoke("get_structural_diff", { repoPath, oid, path, staged });
}

/**
 * V1 · V7 · V8 · V9 · V17 as one report. Expensive — parses every changed file,
 * so it runs only when the user asks for it, never on selection.
 *
 * Registry coverage is filled by the backend exactly once here, so this report's
 * `checked`/`unchecked` must not be merged into another report's accounting.
 */
export async function verifySyntax(
  repoPath: string,
  oid: string | null,
  staged: boolean,
): Promise<VerificationReport> {
  return invoke("verify_syntax", { repoPath, oid, staged });
}

/**
 * Start (or resume) the symbol index and return immediately. Progress arrives
 * as `verify:index-progress`; a build already running is left alone.
 */
export async function buildSymbolIndex(repoPath: string): Promise<SymbolIndexStatus> {
  return invoke("build_symbol_index", { repoPath });
}

export async function cancelSymbolIndex(repoPath: string): Promise<SymbolIndexStatus> {
  return invoke("cancel_symbol_index", { repoPath });
}

export async function getSymbolIndexStatus(repoPath: string): Promise<SymbolIndexStatus> {
  return invoke("get_symbol_index_status", { repoPath });
}

// Claude Code hooks (commands/hooks.rs) — these edit `~/.claude/settings.json`

/** A probe, never a write. A missing or malformed settings file is a *state*. */
export async function getHookStatus(): Promise<HookStatus> {
  return invoke("get_hook_status");
}

/** The exact fragment, script body and recorded fields. Writes nothing. */
export async function previewHookInstall(): Promise<HookPreview> {
  return invoke("preview_hook_install");
}

/** Explicit opt-in only — the caller must have shown `previewHookInstall()`. */
export async function installVerifyHooks(): Promise<HookChange> {
  return invoke("install_verify_hooks");
}

export async function uninstallVerifyHooks(): Promise<HookChange> {
  return invoke("uninstall_verify_hooks");
}

/**
 * Sessions reconstructed from the hook event log. Same shape as the session-file
 * reader on purpose; an empty list means the hook is not installed, not an error.
 */
export async function listHookSessions(
  repoPath?: string | null,
): Promise<SessionSummary[]> {
  return invoke("list_hook_sessions", { repoPath: repoPath ?? null });
}
