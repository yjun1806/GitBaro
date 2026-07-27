// Tauri wrappers for the `verify` subsystem. Split out of commands.ts on size
// grounds and re-exported from there, so components can import from either
// "@/api/commands" or "@/api/verify".
//
// The rule engine still runs in Rust — it just no longer has screens of its
// own. What reaches the UI now is the session report, which carries the rules'
// output as evidence inside a narrative. The only other survivors are the two
// things that help someone *read* a diff: the structural scan and the symbol
// index it needs.
//
// The Rust command name stays snake_case; only the arguments are camelCase.
// Optional Rust params are sent as explicit `null` rather than omitted.

import { invoke } from "@tauri-apps/api/core";
import type {
  CommitReviewState,
  SessionDigest,
  SessionReport,
  StructuralOutcome,
  SymbolIndexStatus,
} from "@/types";

// Session report (commands/report.rs)

/**
 * Every readable agent session for this repository, newest first.
 *
 * **This is the sole data source for the DECISION A gate** (`useSessionData`):
 * a repository with no agent session log shows no verification UI at all. No
 * session directory, or nothing parseable in it, is an empty list — not an
 * error, and never a prompt to install anything.
 */
export async function listSessionDigests(
  repoPath: string,
  limit?: number | null,
): Promise<SessionDigest[]> {
  return invoke("list_session_digests", { repoPath, limit: limit ?? null });
}

/**
 * One session as one page: what was asked, what was done, what it ran into,
 * what it reaches, and where it drifted from the prompt.
 *
 * Resolves to `null` when the file holds nothing recognisable. Missing pieces
 * (no commit attribution, no symbol index, no resolvable anchor) arrive as a
 * section's `unavailable` reason, never as a rejection.
 */
export async function getSessionReport(
  repoPath: string,
  sessionPath: string,
): Promise<SessionReport | null> {
  return invoke("get_session_report", { repoPath, sessionPath });
}

// Session review mark (commands/review.rs)
//
// The per-file review surface is gone, but the commit-level mark survives as
// the report page's one action: "이 세션 검토 완료". Unlisted commits come back
// as `unreviewed` — an absent mark is not an error.

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
