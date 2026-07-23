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
    | "RepoNotFound";
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
  aheadBehindHead: { ahead: number; behind: number } | null;
  lastCommitTime: number | null;
  isFullyMerged: boolean;
  lastCommitAuthor: { name: string; email: string } | null;
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
