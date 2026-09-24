export interface AppError {
  type:
    | "Git"
    | "GitCli"
    | "MergeConflict"
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
    | "BareRepository";
  message: string;
}

/** push가 실제로 올릴 곳 (`git push <remote> <refspec>`). */
export interface PushTarget {
  remote: string;
  refspec: string;
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
  /** Previous path when the entry is a rename or copy (`git mv`). */
  origPath?: string | null;
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

/**
 * 저장소별 "원격 자동 최신화" 방식.
 * - off: 자동으로 아무것도 하지 않는다
 * - fetch: 원격을 확인(fetch)해 앞섬·뒤처짐만 갱신한다
 * - pull: 확인한 뒤, 안전할 때만 현재 브랜치를 fast-forward한다
 */
export type AutoSyncMode = "off" | "fetch" | "pull";

/** 자동 최신화 주기(분). */
export type AutoSyncIntervalMinutes = 1 | 3 | 5 | 10 | 30;

export interface AutoSyncSetting {
  mode: AutoSyncMode;
  intervalMinutes: AutoSyncIntervalMinutes;
}

/** 자동 fast-forward 판단에 쓰는 저장소 상태 (fetch 직후 기준). */
export interface AutoSyncSnapshot {
  detached: boolean;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  /** 스테이징·수정·추적되지 않은 파일이 하나도 없다. */
  isClean: boolean;
  /** merge·rebase·cherry-pick·revert 등이 진행 중이다. */
  operationInProgress: boolean;
}

/** 자동 fast-forward 결과. commits가 0이면 조건이 맞지 않아 건너뛰었다. */
export interface AutoFastForwardResult {
  commits: number;
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
  /**
   * 작업 디렉토리가 사라진 워크트리. git은 `git worktree prune` 전까지 관리 파일을
   * 남겨두므로 목록에는 계속 나타나지만 실제로는 열 수 없다.
   */
  isPrunable: boolean;
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
  /**
   * 사용자가 직접 실행한 작업이 아니라 앱이 주기적으로 도는 작업인지.
   * 성공한 자동 작업은 활동 로그에 남기지 않는다(백그라운드 fetch가 로그를
   * 뒤덮어 실제 사용자 행동을 파묻는 것을 막기 위해).
   */
  automatic?: boolean;
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

/** A multi-step git operation that stops for conflict resolution. */
export type GitOperation = "merge" | "rebase" | "cherryPick" | "revert" | "squash";
