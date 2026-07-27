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

// ── Session report (verify subsystem) ───────────────────────────────────────
//
// Mirrors `src-tauri/src/verify/report/model.rs`. Every Rust struct there
// carries `#[serde(rename_all = "camelCase")]`, and every enum is a plain
// camelCase string except `CallerResolution`, which is tagged on `type`.
//
// The rule engine has no screens of its own. It feeds *this*: one page per
// agent session, five sections, each answering a question the reader actually
// asked. A line that would not change what they do next is not on the page.
//
// Time unit: every timestamp in this subsystem is epoch **milliseconds**
// (`CommitInfo.timestamp` above is in seconds — do not mix them).

/** Declared low → high. Sort ascending, display descending. */
export type Severity = "info" | "warn" | "danger";

export type SessionSource = "claudeCode" | "codex";

/**
 * V30 — how strongly a commit is tied to a session. `high` may be stated as
 * fact; `medium` must carry an estimate chip; `low` is dropped by the backend
 * and never arrives here.
 */
export type LinkConfidence = "high" | "medium" | "low";

/**
 * Where one item came from. The UI calibrates how plainly it may speak: the
 * session log is fact, a correlation is an estimate.
 */
export type Provenance = "sessionLog" | "git" | "symbolIndex" | "derived";

/**
 * Why a whole section cannot answer. A section with `unavailable` set arrives
 * with its body fields empty — it is never half-filled.
 */
export interface Unavailable {
  reason: UnavailableReason;
  /**
   * **Not translated.** A factual sentence from the backend, e.g.
   * `"symbol index is partial (412 of 5100 file(s) indexed)"`. The heading
   * comes from `t("report.unavailable.<reason>")`.
   */
  detail: string | null;
}

export type UnavailableReason =
  /** No user prompt in the session log at all. */
  | "noPrompt"
  /** No mention in the prompt resolved to anything in this repo (V26 G1). */
  | "noResolvableAnchor"
  /** No commit was attributable to this session with enough evidence. */
  | "noCommitAttribution"
  | "noSymbolIndex"
  /** A partial index is treated exactly like no index. */
  | "partialSymbolIndex"
  /** This agent's log never carried the data (Codex: read/sidechain/compaction). */
  | "unsupportedAgent"
  /** The parse budget ran out before the tail of the log was read. */
  | "parseBudget"
  /** Not applicable — e.g. no signature changed at all. */
  | "notApplicable";

/** Where the session ran, relative to the worktree being looked at. */
export type CwdRelation = "thisWorktree" | "siblingWorktree" | "unrelated";

export interface ReportHeader {
  sessionId: string;
  sessionPath: string;
  source: SessionSource;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  cwd: string;
  gitBranch: string | null;
  /** One line, **composed by the backend**. The UI never assembles it. */
  title: string;
  cwdRelation: CwdRelation;
  /** `truncated || skippedRecords > 0`. When true every count here is a floor. */
  partial: boolean;
  truncated: boolean;
  skippedRecords: number;
  compactionCount: number;
}

// § What was asked

export interface AskedSection {
  unavailable: Unavailable | null;
  /** Oldest first. */
  prompts: PromptRecord[];
  /** Total before truncation, so the UI can say what it is not showing. */
  totalPrompts: number;
}

export interface PromptRecord {
  at: number;
  /** Verbatim, cut at 2000 characters. Never translated, never summarised. */
  text: string;
  truncated: boolean;
  /** 0-based. `0` is the specification anchor; the rest are corrections. */
  ordinal: number;
  /** A compaction followed this prompt — the instruction may have been dropped. */
  compactedAway: boolean;
  provenance: Provenance;
}

// § What was done

export interface DidSection {
  /**
   * **Only the commit half can be unavailable.** File edits come from the
   * session log, so `files` is never empty when the session edited anything.
   */
  unavailable: Unavailable | null;
  /** Empty when attribution was refused. */
  commits: ReportCommit[];
  attribution: CommitAttribution | null;
  /** Repository-relative. Churn descending, then path ascending. */
  files: TouchedFile[];
  filesEditedCount: number;
  filesReadCount: number;
  /** Edited but in none of the attributed commits. Empty when nothing is attributed. */
  uncommittedPaths: string[];
}

export interface ReportCommit {
  commitId: string;
  summary: string;
  authorName: string;
  committedAt: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
  /** In the commit but never edited by this session — the reason for `medium`. */
  unattributedFiles: string[];
  confidence: LinkConfidence;
  provenance: Provenance;
}

export interface CommitAttribution {
  /** The **best** grade among the attributed commits. */
  confidence: LinkConfidence;
  /**
   * Evidence tokens: `"cwd"` | `"branch"` | `"timeWindow"` | `"fileOverlap"` |
   * `"mtime"` | `"author"` | `"reflog"` | `"siblingWorktree"`. Render only
   * tokens from this set — an unknown one means the backend moved on.
   */
  basis: string[];
  /** Candidates that were dropped, and why. */
  rejected: RejectedCommit[];
  /** How many sessions claimed the same commit equally well. */
  ambiguousWith: number;
}

export interface RejectedCommit {
  commitId: string;
  reason: RejectionReason;
}

export type RejectionReason =
  | "mergeCommit"
  | "branchMismatch"
  | "noFileOverlap"
  | "outsideSessionWindow"
  | "differentWorktree"
  | "differentAuthor"
  | "ambiguousWithAnotherSession"
  /** A partial log cannot support a partial-coverage claim. */
  | "partialLogInsufficient";

export interface TouchedFile {
  /** **Repository-relative.** Absolute paths from the log are normalised here. */
  path: string;
  /** V25 churn — where the session floundered. The point of this section. */
  editCount: number;
  wasReadFirst: boolean;
  bySubagent: boolean;
  viaBash: boolean;
  afterCompaction: boolean;
  firstEditAt: number;
  lastEditAt: number;
  /** From the attributed commits. `null` when nothing is attributed. */
  addedLines: number | null;
  removedLines: number | null;
  inCommit: boolean;
  isTest: boolean;
  provenance: Provenance;
}

// § What it went through

export interface WentThroughSection {
  unavailable: Unavailable | null;
  bashTotal: number;
  testRuns: number;
  failedTestRuns: number;
  /** Oldest first. Plain `other` bash never appears — 120 `ls` calls are not a story. */
  events: OrdealEvent[];
  /** Promoted out of the stream: the single most action-changing line here. */
  testEditsAfterFailure: TestEditAfterFailure[];
  /** Code changed and the tests were never run once (V20). */
  neverRanTests: boolean;
}

export interface OrdealEvent {
  at: number;
  kind: OrdealKind;
  /** Command text or path, cut at 512 characters. **Never translated.** */
  evidence: string;
  /** Extra evidence: the bypass token, the mutated path. */
  detail: string | null;
  severity: Severity;
  provenance: Provenance;
}

export type OrdealKind =
  | "testPassed"
  | "testFailed"
  /** `--no-verify`, `SKIP=`, `push -f`, `chmod` … */
  | "hookBypass"
  /** Shell redirect, `sed -i`, `rm` — outside checkpoint restore (V22). */
  | "shellMutation"
  | "compaction"
  | "subagentEdit";

export interface TestEditAfterFailure {
  testPath: string;
  /** Failures observed **before** this edit. Only ≥ 2 is reported. */
  failuresBefore: number;
  /** The failing commands, verbatim. At most 5. */
  failingCommands: string[];
  editedAt: number;
}

// § What is affected

export interface ImpactSection {
  unavailable: Unavailable | null;
  /** Only entries with `untouchedCallerCount > 0` — the rest have nothing to say. */
  entries: BlastRadiusEntry[];
  totalUntouchedCallers: number;
  indexState: IndexState;
  basis: ImpactBasis;
  provenance: Provenance;
}

/** Which baseline the blast radius was computed against. */
export type ImpactBasis =
  /** First parent of the oldest attributed commit → the newest. Most precise. */
  | "attributedCommitRange"
  /** HEAD ↔ worktree, narrowed to the session's paths. May include later edits. */
  | "worktreeFallback";

/** V9 — one signature change and everything that calls it. */
export interface BlastRadiusEntry {
  symbol: string;
  file: string;
  kind: SymbolKind;
  signatureChanged: boolean;
  /** Capped by the backend. */
  callers: CallSite[];
  callerCount: number;
  /** Callers in files this change does not touch — the ones worth naming. */
  untouchedCallerCount: number;
  resolution: CallerResolution;
}

export interface CallSite {
  file: string;
  line: number;
  /** The symbol containing the call; `null` for top-level code. */
  symbol: string | null;
  touchedInDiff: boolean;
}

/**
 * Internally tagged on `type`. Ambiguity is stated, not hidden: misattribution
 * is worse than no attribution.
 */
export type CallerResolution =
  | { type: "nameUnique" }
  | { type: "nameAmbiguous"; definitions: number };

// § What differs from what was asked (V26)

export interface DriftSection {
  /** `noPrompt` or `noResolvableAnchor`. Zero anchors ends the section (G1). */
  unavailable: Unavailable | null;
  /** Every mention pulled out of the prompts — resolved and unresolved alike. */
  mentions: PromptMention[];
  inScopePaths: string[];
  /** Churn descending, cut at 20; `driftedTotal` carries the real count. */
  driftedPaths: DriftedPath[];
  driftedTotal: number;
  changedTotal: number;
  verdict: DriftVerdict;
  confidence: LinkConfidence;
  basis: ImpactBasis;
}

export interface PromptMention {
  /** The token as written in the prompt. Quoted verbatim. */
  raw: string;
  extractor: MentionExtractor;
  /** `null` means unresolved — an unresolved mention never narrows scope (G4). */
  resolved: ResolvedAnchor | null;
  /** Which prompt it came from. */
  promptOrdinal: number;
}

export type MentionExtractor =
  /** Inside backticks. The strongest signal. */
  | "backtick"
  /** Carries a known file extension. */
  | "extension"
  /** Carries a slash (`src/verify`, `@/api/commands`). */
  | "pathLike"
  /** CamelCase / snake_case. Only active when a symbol index exists. */
  | "identifier";

export interface ResolvedAnchor {
  /** Repository-relative. Directories end with `/`. */
  path: string;
  kind: AnchorKind;
}

export type AnchorKind = "file" | "directory" | "symbolDefinition";

export interface DriftedPath {
  path: string;
  editCount: number;
  addedLines: number | null;
  removedLines: number | null;
  isTest: boolean;
}

export type DriftVerdict =
  /** Zero anchors — arrives with `unavailable` and renders nothing. */
  | "noAnchor"
  | "withinScope"
  | "partialDrift"
  /** Anchors resolved and **none** of them changed. The most valuable verdict. */
  | "fullDrift";

/** One session, one page. Everything it needs is in here — no second call. */
export interface SessionReport {
  header: ReportHeader;
  asked: AskedSection;
  did: DidSection;
  wentThrough: WentThroughSection;
  impact: ImpactSection;
  drift: DriftSection;
  /** Epoch milliseconds. */
  generatedAt: number;
}

/**
 * The list row. Also the **only** input to the DECISION A gate: an empty array
 * means this repository shows no verification UI at all.
 */
export interface SessionDigest {
  sessionId: string;
  sessionPath: string;
  source: SessionSource;
  /** Same rule as `ReportHeader.title`. */
  title: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  gitBranch: string | null;
  filesEditedCount: number;
  /** Only `high`/`medium` attributions. Empty when attribution was refused. */
  commitIds: string[];
  attribution: LinkConfidence | null;
  partial: boolean;
}

// ── Session review mark ─────────────────────────────────────────────────────
//
// Mirrors `CommitReviewState` / `ReviewStatus` in `src-tauri/src/verify/types.rs`.
// The per-file review UI is gone; what survives is the one control the report
// page still needs — "이 세션 검토 완료". The mark is stored per commit because
// a commit id is the only durable handle here, so a session's attributed
// commits are marked together.

/** Commits are immutable, so a commit is never `stale` — only files can be. */
export type ReviewStatus = "unreviewed" | "reviewed" | "stale";

export interface CommitReviewState {
  commitId: string;
  status: ReviewStatus;
  /** Epoch milliseconds. */
  reviewedAt: number | null;
  /** git `user.name <user.email>` at the time of marking. */
  reviewer: string | null;
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

// ── Events ──────────────────────────────────────────────────────────────────

/** Payload of the `verify:index-progress` Tauri event emitted by `build_symbol_index`. */
export interface VerifyIndexProgressEvent {
  repoPath: string;
  phase: IndexPhase;
  filesDone: number;
  filesTotal: number;
  symbols: number;
  running: boolean;
}
