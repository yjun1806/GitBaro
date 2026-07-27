export interface AppError {
  type:
    | "Git"
    | "GitCli"
    | "Auth"
    | "TokenExpired"
    | "Keychain"
    | "GithubApi"
    | "RateLimit"
    | "Network"
    | "Io"
    | "Serde"
    | "GitCliNotFound"
    | "GhCliNotFound"
    | "GhCli"
    | "GhVersionTooOld"
    | "Channel"
    | "RepoNotFound"
    | "Verify"
    | "SessionParse";
  message: string;
}

export interface GitHubAccount {
  id: string;
  username: string;
  email: string;
  avatarUrl: string;
}

export interface GhStatus {
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
  accounts: { username: string; active: boolean }[];
  versionError?: boolean;
}

export interface RepoAccountMapping {
  repoPath: string;
  repoId: string | null;
  remoteName: string;
  accountId: string;
  remoteUrl: string;
}

export interface StatusEntry {
  path: string;
  status: FileStatus;
  staged: boolean;
  modifiedAt?: number | null;
  insertions?: number | null;
  deletions?: number | null;
  sizeBytes?: number | null;
}

export type FileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "ignored"
  | "conflicted";

export interface DiffOutput {
  filePath: string;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
  binary: boolean;
  binaryPreview?: BinaryPreview;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  content: string;
  lineType: "add" | "delete" | "context";
  oldLineNo: number | null;
  newLineNo: number | null;
}

export type BinaryFileType = "image" | "svg" | "unknown";

export interface BinaryFileMeta {
  fileType: BinaryFileType;
  mimeType: string;
  oldSize: number | null;
  newSize: number | null;
  tooLarge?: boolean;
}

export interface BinaryPreview {
  meta: BinaryFileMeta;
  oldBase64: string | null;
  newBase64: string | null;
}

export type RefKind = "tag" | "localBranch" | "remoteBranch";

export interface RefLabel {
  name: string;
  kind: RefKind;
  isHead: boolean;
}

export interface CommitInfo {
  id: string;
  shortId: string;
  message: string;
  summary: string;
  author: AuthorInfo;
  committer: AuthorInfo;
  timestamp: number;
  parentIds: string[];
  refs: RefLabel[];
  /**
   * 아직 리모트로 push되지 않은 커밋인지 (히스토리 업로드 화살표 표시용).
   * 히스토리 타임라인(getCommitHistory)에서만 채워지며, 커밋 상세·브랜치 비교
   * 컨텍스트에서는 undefined다.
   */
  isUnpushed?: boolean;
}

export interface AuthorInfo {
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface BranchInfo {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  isDefault: boolean;
  upstream: string | null;
  aheadBehind: { ahead: number; behind: number } | null;
  lastCommitTime: number | null;
  isFullyMerged: boolean;
  lastCommitAuthor: { name: string; email: string } | null;
}

/**
 * 각 브랜치가 현재 HEAD 대비 앞선/뒤처진 커밋 수. 브랜치 비교 셀렉터 전용이며,
 * `get_branch_divergence`로 비교 셀렉터가 열릴 때만 조회한다(지연 계산).
 */
export interface BranchDivergence {
  name: string;
  ahead: number;
  behind: number;
}

export interface RepoInfo {
  path: string;
  name: string;
  currentBranch: string | null;
  isDirty: boolean;
  remotes: RemoteInfo[];
  accountId: string | null;
  isWorktree?: boolean;
}

/**
 * HEAD 브랜치가 upstream 대비 얼마나 앞서/뒤처졌는지. 마지막 fetch 시점의
 * 원격 상태 기준이라 behind는 백그라운드 fetch 이후에 갱신된다.
 */
export interface RepoSyncStatus {
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  /** working-tree에 커밋되지 않은 변경이 있는지 (RepoInfo.isDirty와 동일 기준). */
  isDirty: boolean;
}

export interface RemoteInfo {
  name: string;
  url: string;
}

export interface AppSettings {
  theme: Theme;
  defaultEditor: string;
  defaultShell: string;
  defaultAiCli: string;
  autoFetchInterval: number;
  language: string;
}

export type Theme = "light" | "dark" | "system";

export interface EditorInfo {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  icon: string | null;
}

export interface TerminalInfo {
  id: string;
  name: string;
  installed: boolean;
  icon: string | null;
}

export interface AiCliInfo {
  id: string;
  name: string;
  command: string;
  installed: boolean;
}

export interface BranchCompareResult {
  baseBranch: string;
  compareBranch: string;
  aheadCount: number;
  behindCount: number;
  aheadCommits: CommitInfo[];
  behindCommits: CommitInfo[];
}

export type MergeStrategy = "merge" | "squash" | "rebase";

export interface MergeOperationResult {
  success: boolean;
  strategy: MergeStrategy;
  message: string;
  hasConflicts: boolean;
}

export interface MergePreCheckResult {
  canFastForward: boolean;
  hasConflicts: boolean;
  conflictFiles: string[];
}

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  isMain: boolean;
  isBare: boolean;
  isLocked: boolean;
  lockReason: string | null;
  isDirty: boolean;
}

// ── Stash ────────────────────────────────────────────────────────────────────

export interface StashEntry {
  index: number;
  message: string;
  commitId: string;
  branchName: string | null;
  timestamp: number;
}

export interface StashFileSummary {
  path: string;
  status: string;
  insertions: number;
  deletions: number;
}

export interface StashShowResult {
  entry: StashEntry;
  files: StashFileSummary[];
}

// ── Actions (GitHub Actions) ──

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
  headSha: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  runNumber: number;
}

export interface WorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: JobStep[];
}

export interface JobStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

// ── Activity ──

export type OperationType =
  | "fetch"
  | "push"
  | "pull"
  | "clone"
  | "merge"
  | "commit"
  | "checkout"
  | "stash"
  | "rebase"
  | "status"
  | "log";

export interface GitCommandEntry {
  id: string;
  command: string;
  operation: OperationType;
  repoPath: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  success?: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  resultSummary?: OperationSummary;
  progress?: { message: string; percent?: number };
}

export type OperationSummary =
  | {
      type: "fetch";
      updatedBranches: BranchUpdate[];
      newBranches: string[];
      deletedBranches: string[];
    }
  | { type: "push"; branch: string; commitCount: number; remote: string }
  | {
      type: "pull";
      mergeType: string;
      filesChanged: number;
      hasConflicts: boolean;
    }
  | {
      type: "merge";
      mergeType: string;
      filesChanged: number;
      hasConflicts: boolean;
      sourceBranch: string;
    };

export interface BranchUpdate {
  name: string;
  oldOid: string;
  newOid: string;
}

// ── Verification (verify subsystem) ─────────────────────────────────────────
//
// Mirrors `src-tauri/src/verify/types.rs` and `verify/registry.rs`. Every Rust
// struct there carries `#[serde(rename_all = "camelCase")]`, and every enum is
// a plain camelCase string except `EvidenceFreshness`, which is internally
// tagged on `type`.
//
// Time unit: every timestamp in this subsystem is epoch **milliseconds**
// (`CommitInfo.timestamp` above is in seconds — do not mix them).

/** Declared low → high. Sort ascending, display descending. */
export type Severity = "info" | "warn" | "danger";

/** One value per implemented rule. `Finding.ruleId` is the stable wire id. */
export type FindingKind =
  // V2: test disabling
  | "testSkipAdded"
  | "testFileDeleted"
  | "assertionRemoved"
  // V3: test quality anti-patterns
  | "vacuousAssertion"
  | "mockOnlyAssertion"
  | "noAssertionTest"
  | "broadExceptionAssertion"
  | "assertionRoulette"
  // V4: hallucinated dependencies
  | "hallucinatedDependency"
  | "suspiciousNewDependency"
  // V5: verification bypass traces (static)
  | "verificationBypassed"
  | "typeEscapeHatchAdded"
  | "emptyCatchAdded"
  | "unsafeUnwrapAdded"
  // V6: scope drift
  | "scopeDrift"
  // V10: deletion classification
  | "publicExportDeleted"
  | "errorHandlingDeleted"
  | "validationDeleted"
  // V11 / V12: execution evidence
  | "testEvidenceMissing"
  | "testEvidenceStale"
  | "testEvidenceFailed"
  | "uncoveredNewLines"
  // V19~V27: session logs
  | "readLessEdit"
  | "testFailureThenTestEdited"
  | "testsNeverRunInSession"
  | "hookBypassCommand"
  | "unrewindableChange"
  | "subagentEdit"
  | "postCompactionEdit"
  | "repeatedEdit"
  | "promptScopeDrift"
  | "staleRulesInjected"
  // V31 / V32 / V35: commit hygiene
  | "tangledCommit"
  | "revertUnsafe"
  | "agentTrailerMismatch";

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  /** Repository-relative path. Commit- and session-level findings carry `""`. */
  file: string;
  /** 1-based line in the new file, when one can be pinpointed. */
  line: number | null;
  /**
   * **Not translated.** A factual evidence sentence from the backend, e.g.
   * `"it.skip added"`. Render it verbatim; the title and description come from
   * `t("verify.rule.<ruleId>.title" | ".description")`.
   */
  message: string;
  /** Extra evidence (snippet, command). Backend truncates at 512 characters. */
  detail: string | null;
  /** Stable wire id, e.g. `"v2.testSkipAdded"`. Doubles as the i18n key. */
  ruleId: string;
}

/**
 * The honesty contract (spec §7-①): findings alone never mean "safe". Always
 * render `checked` / `unchecked` next to the findings — an empty `findings`
 * list means "nothing was flagged by the rules that ran", never "passed".
 */
export interface VerificationReport {
  findings: Finding[];
  /** Rule ids that actually ran against at least one target. */
  checked: string[];
  /** Rule ids with at least one target they could not look at. */
  unchecked: string[];
  /** Why each unchecked rule was skipped. */
  limits: ScanLimit[];
  /** Epoch milliseconds. */
  generatedAt: number;
}

export interface ScanLimit {
  ruleId: string;
  reason: UncheckedReason;
  /** Concrete, human-readable cause, e.g. `"lcov.info not found"`. */
  detail: string | null;
}

/** i18n: `t("verify.unchecked.<reason>")`. */
export type UncheckedReason =
  | "disabled"
  | "notApplicable"
  | "unsupportedLanguage"
  | "missingArtifact"
  | "parseFailed"
  | "budgetExceeded"
  | "notImplemented";

export type RuleStatus = "implemented" | "planned";

/**
 * A registry row for the settings screen. `Planned` rules are included on
 * purpose so the UI can show what is *not* being checked.
 */
export interface RuleDescriptor {
  ruleId: string;
  /** `null` for planned rules, which have no `FindingKind` yet. */
  kind: FindingKind | null;
  vNumber: string;
  /** Spec layer, 0–6. */
  layer: number;
  defaultSeverity: Severity;
  status: RuleStatus;
  enabled: boolean;
}

/** Lightweight per-commit badge summary for history lists. */
export interface CommitVerificationSummary {
  commitId: string;
  /** `null` when there are no findings — which is not the same as safe. */
  maxSeverity: Severity | null;
  dangerCount: number;
  warnCount: number;
  infoCount: number;
  /** Rules left unchecked for this commit. Show it on the badge. */
  uncheckedCount: number;
}

// ── Review state (V13 · V29 · V34 · V33) ────────────────────────────────────

/** `stale` means the content changed after review, so it went back to unreviewed. */
export type ReviewStatus = "unreviewed" | "reviewed" | "stale";

/**
 * The on-disk review mark. Never crosses IPC and the frontend must never build
 * one — `markFileReviewed` sends a path and the backend derives the diff hash.
 */
export interface FileReviewMark {
  path: string;
  reviewedDiffHash: string;
  reviewedAt: number;
  reviewer: string;
}

export interface FileReviewEntry {
  path: string;
  status: ReviewStatus;
  reviewedAt: number | null;
  reviewer: string | null;
}

export interface CommitReviewState {
  commitId: string;
  /** Commits are immutable, so this is only `unreviewed` or `reviewed`. */
  status: ReviewStatus;
  reviewedAt: number | null;
  reviewer: string | null;
}

/** V29 — the unreviewed-commit queue. */
export interface ReviewQueue {
  /** Newest first. */
  unreviewedCommitIds: string[];
  totalUnreviewed: number;
  /** Whether `unreviewedCommitIds` was cut off by the limit. */
  truncated: boolean;
  lastReviewedAt: number | null;
}

/** V34 — the pre-push gate. **Display only. It never blocks the push.** */
export interface PushGateSummary {
  commits: PushGateCommit[];
  unreviewedCount: number;
  dangerCount: number;
  warnCount: number;
  /** Commits touching enough files that a clean revert is unlikely (V31). */
  tangledCount: number;
}

export interface PushGateCommit {
  commitId: string;
  summary: string;
  reviewStatus: ReviewStatus;
  filesChanged: number;
  /** `null` when there are no findings — not a clean bill of health. */
  maxSeverity: Severity | null;
  findingCount: number;
}

/** V33 — the git-notes evidence ledger. Off by default, local only, never pushed. */
export interface EvidenceLedgerEntry {
  commitId: string;
  recordedAt: number;
  recordedBy: string;
  checks: LedgerCheck[];
  /** GitBaro version at record time — the format will evolve. */
  toolVersion: string;
}

export interface LedgerCheck {
  ruleId: string;
  outcome: LedgerOutcome;
  findingCount: number;
}

export type LedgerOutcome = "passed" | "flagged" | "skipped";

// ── Execution evidence (V11 · V12) ──────────────────────────────────────────

export interface TestEvidence {
  /** Worktree hash the run is bound to (40 hex characters). */
  worktreeHash: string;
  /** Manifest used to diff the evidence against the tree. Empty above 5000 lines. */
  manifest: string[];
  command: string;
  exitCode: number | null;
  passed: boolean;
  ranAt: number;
  durationMs: number;
  /** Last 8 KiB of stdout+stderr. May contain secrets — never log or upload it. */
  outputTail: string;
}

/** Internally tagged on `type`. `changedFiles` is `null` when it is unknown. */
export type EvidenceFreshness =
  | { type: "fresh" }
  | { type: "stale"; changedFiles: number | null }
  | { type: "absent" };

export interface TestEvidenceStatus {
  evidence: TestEvidence | null;
  freshness: EvidenceFreshness;
  currentWorktreeHash: string;
}

export interface DiffCoverage {
  path: string;
  addedLines: number;
  coveredAddedLines: number;
  uncoveredAddedLines: number[];
}

export interface CoverageResult {
  /** Repository-relative path of the parsed report. Empty when none was found. */
  source: string;
  parsedAt: number;
  files: DiffCoverage[];
  /** Changed files absent from the report — coverage is *undecidable* for these. */
  unmappedFiles: string[];
}

// ── Session evidence (V19~V27 · V30) ────────────────────────────────────────

export type SessionSource = "claudeCode" | "codex";

export interface SessionSummary {
  sessionId: string;
  source: SessionSource;
  /** Absolute path of the session JSONL — the re-lookup key for other commands. */
  filePath: string;
  cwd: string;
  gitBranch: string | null;
  startedAt: number;
  endedAt: number;
  /** V26 — the specification anchor. Truncated at 2000 chars. Stays local. */
  firstUserPrompt: string | null;
  filesRead: string[];
  filesEdited: FileEditSummary[];
  bashCommands: BashCommandRecord[];
  /** V24 — compaction boundary timestamps. */
  compactionBoundaries: number[];
  /** V27 — digest of injected CLAUDE.md/AGENTS.md content (body not stored). */
  injectedRulesDigest: string | null;
  /** The tail could not be read within budget — every derived signal is partial. */
  truncated: boolean;
  /** Records skipped (over-long lines, parse failures). Non-zero ⇒ partial. */
  skippedRecords: number;
}

export interface FileEditSummary {
  path: string;
  /** V25 — re-edit count (a floundering indicator). */
  editCount: number;
  firstEditAt: number;
  lastEditAt: number;
  /** V19 — was it Read/Grep'd in this session before the first edit? */
  wasReadFirst: boolean;
  /** V24 — edited after a compaction boundary? */
  afterCompaction: boolean;
  /** V23 — edited by a subagent? */
  bySubagent: boolean;
  /** V22 — changed through Bash, i.e. outside `/rewind`'s restore scope? */
  viaBash: boolean;
}

export interface BashCommandRecord {
  /** Truncated at 512 chars. */
  command: string;
  at: number;
  isError: boolean;
  kind: BashCommandKind;
}

export type BashCommandKind = "testRun" | "hookBypass" | "fileMutation" | "other";

/**
 * V30 — session ↔ commit correlation. Heuristic by nature: a `low` confidence
 * link must be rendered as an estimate or not at all, never as settled fact.
 */
export interface SessionCommitLink {
  sessionId: string;
  sessionPath: string;
  /** Newest first. */
  commitIds: string[];
  confidence: LinkConfidence;
  /** Evidence tokens: `"cwd"` | `"branch"` | `"timeWindow"` | `"fileOverlap"`. */
  basis: string[];
}

export type LinkConfidence = "high" | "medium" | "low";

// ── Multi-file diff (session cumulative diff) ───────────────────────────────
//
// `get_session_cumulative_diff` returns Rust `git::engine::DiffOutput`, which
// is a *list* of file diffs. That is a different shape from the single-file
// `DiffOutput` above (which the diff commands map into), so it gets its own
// names rather than overloading them.

export interface SessionDiff {
  files: SessionDiffFile[];
}

export interface SessionDiffFile {
  oldPath: string | null;
  newPath: string | null;
  isBinary: boolean;
  hunks: SessionDiffHunk[];
}

export interface SessionDiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: SessionDiffLine[];
}

export interface SessionDiffLine {
  /** git2 line origin — `"+"`, `"-"` or `" "` for the lines rendered in a hunk. */
  origin: string;
  content: string;
  oldLineno: number | null;
  newLineno: number | null;
}

// ── Structural diff (V1 · V17) ──────────────────────────────────────────────
//
// Mirrors `src-tauri/src/verify/structural/`. This is the one rule that carries
// *good* news: it says which changed lines a reviewer may skip. It never says a
// file is correct — a file that could not be parsed comes back `degraded`, and
// the caller must then keep the text diff as the only truth.

/** The whole supported language surface. Anything else degrades. */
export type SyntaxLanguage = "typeScript" | "tsx" | "javaScript" | "jsx" | "rust";

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "typeAlias"
  | "const"
  | "struct"
  | "enum"
  | "trait"
  | "impl"
  | "macro";

/** 1-based inclusive lines, half-open byte range. */
export interface Span {
  startLine: number;
  endLine: number;
  startByte: number;
  endByte: number;
}

/** 1-based inclusive line range in the **new** file. */
export interface LineRange {
  startLine: number;
  endLine: number;
}

/** Everything except `semantic` is noise a reviewer can skip. */
export type FileVerdict =
  | "identical"
  | "formattingOnly"
  | "commentsOnly"
  | "renameOnly"
  | "moved"
  | "semantic";

export type SymbolVerdict =
  | "unchanged"
  | "moved"
  | "commentsOnly"
  | "renameOnly"
  | "signatureOnly"
  | "changed"
  | "added"
  | "removed";

export interface SymbolChange {
  verdict: SymbolVerdict;
  /** New name, or the old name when the declaration was removed. */
  name: string;
  oldName: string | null;
  kind: SymbolKind;
  container: string | null;
  exported: boolean;
  /** New-file location. `null` for `removed`. */
  span: Span | null;
  /** Old-file location. `null` for `added`. */
  oldSpan: Span | null;
}

export type ApiChangeKind =
  | "added"
  | "removed"
  | "renamed"
  | "arityChanged"
  | "visibilityChanged";

export interface ApiChange {
  name: string;
  kind: SymbolKind;
  change: ApiChangeKind;
  /** **Not translated** — factual evidence, e.g. `"arity 2 → 3"`. */
  detail: string;
}

export interface StructuralSummary {
  totalSymbols: number;
  unchanged: number;
  moved: number;
  commentsOnly: number;
  renamed: number;
  signatureOnly: number;
  changed: number;
  added: number;
  removed: number;
  /** changed + signatureOnly + added + removed. */
  semanticSymbols: number;
  /** New-file line ranges those declarations occupy, sorted and coalesced. */
  semanticRanges: LineRange[];
  semanticLines: number;
}

export interface StructuralFileDiff {
  path: string;
  language: SyntaxLanguage;
  verdict: FileVerdict;
  summary: StructuralSummary;
  symbols: SymbolChange[];
  api: ApiChange[];
}

/** Why a file was not compared. Never a risk signal — it is an *unchecked* file. */
export type DegradeReason =
  | "unsupportedLanguage"
  | "parseError"
  | "tooLarge"
  | "notComparable";

/**
 * Internally tagged on `type`. `degraded` is a normal answer, not an error:
 * the caller keeps the text diff and offers no structural affordance at all.
 */
export type StructuralOutcome =
  | { type: "compared"; diff: StructuralFileDiff }
  | { type: "degraded"; reason: DegradeReason; detail: string };

// ── Symbol index (V7 · V8 · V9) ─────────────────────────────────────────────
//
// Mirrors `src-tauri/src/verify/context/`. Building is opt-in and cancellable;
// without an index those three rules stay `unchecked`, which is the honest
// state — never a silent pass.

export type IndexState = "idle" | "building" | "ready" | "cancelled" | "failed";

export interface SymbolIndexStatus {
  state: IndexState;
  filesIndexed: number;
  filesTotal: number;
  symbols: number;
  complete: boolean;
  /** Epoch milliseconds. */
  builtAt: number | null;
  /** `[extension, count]` for files outside the language scope. */
  skippedByLanguage: [string, number][];
  skippedByBudget: number;
  /** Files that parsed with an ERROR node. */
  parseFailed: number;
}

export type IndexPhase = "enumerating" | "parsing" | "writing" | "done" | "cancelled";

// ── Agent hooks (V28) ───────────────────────────────────────────────────────
//
// Mirrors `src-tauri/src/verify/hooks.rs`. These commands edit
// `~/.claude/settings.json`, a file the user owns — install is a click behind an
// explicit preview, never a side effect.

/** `ok` is the only state install/uninstall accept. */
export type SettingsState = "ok" | "missing" | "malformed";

export interface HookStatus {
  settingsPath: string;
  settingsState: SettingsState;
  installed: boolean;
  /** Lowest version found among our entries — an older one means "upgrade". */
  installedVersion: number | null;
  currentVersion: number;
  needsUpgrade: boolean;
  installedEvents: string[];
  scriptPath: string;
  scriptPresent: boolean;
  logDir: string;
  logFiles: number;
  logBytes: number;
}

/** Everything the consent dialog shows. Nothing here is written. */
export interface HookPreview {
  settingsPath: string;
  settingsState: SettingsState;
  /** The exact JSON merged under the top-level `hooks` key, pretty-printed. */
  settingsFragment: string;
  scriptPath: string;
  /** The exact bytes written to `scriptPath`. */
  scriptBody: string;
  logDir: string;
  /** Plain-language list of what the log will contain. */
  recordedFields: string[];
}

export interface HookChange {
  settingsPath: string;
  /** `null` when nothing had to be written, so no backup was taken. */
  backupPath: string | null;
  changed: boolean;
  events: string[];
}

// ── Events ──────────────────────────────────────────────────────────────────

/** Payload of the `verify:test-progress` Tauri event emitted by `run_test_command`. */
export interface VerifyTestProgressEvent {
  repoPath: string;
  /** Last output line, cut at 2048 characters. Empty on the final `running: false`. */
  line: string;
  running: boolean;
}

/** Payload of the `verify:index-progress` Tauri event emitted by `build_symbol_index`. */
export interface VerifyIndexProgressEvent {
  repoPath: string;
  phase: IndexPhase;
  filesDone: number;
  filesTotal: number;
  symbols: number;
  running: boolean;
}
