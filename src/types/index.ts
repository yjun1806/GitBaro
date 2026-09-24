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
  /** `Co-Authored-By:` 트레일러의 공동 작성자. 모든 커밋 응답(히스토리·상세·브랜치 비교)이 채운다. */
  coAuthors: CoAuthor[];
  /**
   * `Co-Authored-By` 트레일러에 코딩 에이전트(Claude, Codex 등)가 있는지. 커밋 작성자는
   * 보지 않는다. 판별 규칙은 Rust `git::commit::is_agent_co_author` 한 곳에 있다.
   * 확정이 아닌 추정이므로 화면에서는 흐리게 표시한다.
   */
  isAgentAuthored: boolean;
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
  /** working-tree에 커밋되지 않은 변경이 있는지 (RepoInfo.isDirty와 동일 기준, `dirtyCount > 0`). */
  isDirty: boolean;
  /** 커밋하지 않은 파일 수. 추적하지 않는 폴더 안의 파일까지 하나씩 센다. */
  dirtyCount: number;
  /** 커밋하지 않은 파일 중 가장 늦은 수정 시각(epoch ms). 없으면 null. */
  dirtyLatestMtime: number | null;
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

/**
 * 워크트리 브랜치가 갈라져 나온 브랜치.
 * - `recorded`: GitBaro가 워크트리를 만들 때 기록한 값
 * - `reflog`: git이 브랜치를 만들 때 남긴 기록(`branch: Created from X`)
 * - `inferred`: 기록이 없어 분기점이 가장 가까운 브랜치로 추정한 값
 */
export type WorktreeBaseSource = "recorded" | "reflog" | "inferred";

export interface WorktreeBase {
  name: string;
  source: WorktreeBaseSource;
  aheadOfBase: number;
  behindBase: number;
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
  /** 메인·detached 워크트리는 null. */
  base: WorktreeBase | null;
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

// W1-T2
/** 커밋 메시지의 `Co-Authored-By: Name <email>` 트레일러 하나. 이메일이 없으면 빈 문자열. */
export interface CoAuthor {
  name: string;
  email: string;
}

// W1-T3
/** Response of `set_activity_watch`: which requested paths are actually
 * watched (capped at 40) and which overflowed to the polling fallback. */
export interface ActivityWatchResult {
  watched: string[];
  overflow: string[];
}

/** Payload of the `repo:activity` event. */
export interface ActivityEvent {
  path: string;
  /** Epoch ms of the emission. */
  at: number;
}

// W1-T4 — 새 커밋 기준선 (Rust: src-tauri/src/git/new_commits.rs)

/** `review_status`가 돌려주는 워크트리 하나. `path`는 기준선 스토어의 키다. */
export interface ReviewWorktree {
  /**
   * 작업 트리 경로(끝의 `/` 없음). 메인 작업 트리는 요청한 저장소 경로를 그대로 쓴다
   * (심볼릭 링크를 풀지 않아 저장소 목록의 경로와 같다).
   */
  path: string;
  /** 체크아웃한 로컬 브랜치. detached HEAD면 null. */
  branch: string | null;
  /** HEAD 커밋. 커밋이 하나도 없는 저장소면 null. */
  headOid: string | null;
  isMain: boolean;
}

/** 저장소 하나의 워크트리 목록(메인 작업 트리가 맨 앞). 열 수 없는 저장소는 응답에서 빠진다. */
export interface RepoReviewStatus {
  /** 요청에 넘긴 저장소 경로 그대로. */
  repoPath: string;
  worktrees: ReviewWorktree[];
}

/** `count_new_commits`의 입력. 기준선이 없으면 `oid`를 비운다. */
export interface SeenRecordInput {
  path: string;
  oid?: string | null;
  /** 확인한 시각(epoch ms). */
  seenAt?: number | null;
  branch?: string | null;
}

/**
 * 새 커밋을 센 방법.
 * - `oid`: 기준 커밋..HEAD. 기반 브랜치를 병합해 들어온 커밋은 뺀다(기본 브랜치 제외)
 * - `authorTime`: rebase·amend로 기준 커밋이 사라져, 기반 브랜치에 없는 커밋 중 author 시각이
 *   확인 시각과 같은 초이거나 더 늦은 커밋
 * - `mergeBase`: 기준선이 없거나 브랜치가 바뀌어, 기반 브랜치에서 갈라진 지점..HEAD
 */
export type NewCommitBasis = "oid" | "authorTime" | "mergeBase";

/** 워크트리 하나의 새 커밋 수. HEAD가 없거나 열 수 없는 워크트리는 응답에서 빠진다. */
export interface NewCommitCount {
  path: string;
  headOid: string;
  newCount: number;
  basis: NewCommitBasis;
}

// W3-T3

/**
 * `list_new_commit_ids`의 응답. 개수와 규칙은 `NewCommitCount`와 같고, 새 커밋으로 센 커밋의
 * SHA를 함께 준다(최대 1000개. 넘치면 `ids.length < newCount`).
 */
export interface NewCommitIds extends NewCommitCount {
  ids: string[];
}

// W4-T2 — 워크스페이스 타임라인 (Rust: src-tauri/src/commands/workspace_history.rs)

/**
 * 저장소가 main과 갈라진 지점을 찾았는지.
 * - `found`: 찾았다. `commits`는 갈라진 뒤의 커밋이다.
 * - `noDefaultBranch`: 기본 브랜치(또는 그 로컬·원격 브랜치)가 없다.
 * - `noSharedHistory`: 기본 브랜치와 공통 조상이 없다.
 * `found`가 아니면 `commits`는 HEAD 이력을 한도까지 담은 것이라, 「갈라진 뒤 한 일」로 보이면 안 된다.
 */
export type WorkspaceBaseStatus = "found" | "noDefaultBranch" | "noSharedHistory";

/**
 * `get_workspace_history`의 저장소 하나. 저장소마다 따로 계산하고, 브랜치 이름이 같아도 합치지 않는다.
 * 읽지 못한 저장소는 `error`만 채워지고 나머지는 비어 있다.
 */
export interface WorkspaceRepoHistory {
  /** 요청에 넘긴 저장소 경로 그대로. */
  path: string;
  /** 체크아웃한 로컬 브랜치. 커밋이 없는 저장소도 HEAD가 가리키는 이름을 준다. detached HEAD면 null. */
  branch: string | null;
  /** HEAD 커밋. 커밋이 없는 저장소면 null. */
  headOid: string | null;
  /** 기본 브랜치(origin/HEAD → 로컬 main → 로컬 master 순, 워크트리 기반 추정과 같은 규칙). 못 찾으면 null. */
  defaultBranch: string | null;
  /**
   * 갈라진 지점을 준 참조(`main`, `origin/main`). 로컬 main과 origin/main 중 더 가까운 쪽이다.
   * HEAD가 기본 브랜치 자신이면 그 원격 추적 브랜치.
   */
  baseRef: string | null;
  /** 갈라진 지점을 찾았는지. 저장소를 열지 못했거나 커밋이 없으면 null. */
  baseStatus: WorkspaceBaseStatus | null;
  /** main과 갈라진 지점. `baseStatus`가 `found`일 때만 있다. */
  mergeBaseOid: string | null;
  /** 갈라진 지점 커밋(그래프 맨 아래 행의 요약·시각). `mergeBaseOid`와 함께 있다. */
  mergeBaseCommit: CommitInfo | null;
  /** HEAD부터 갈라진 지점 바로 위까지, 최신 순. */
  commits: CommitInfo[];
  /** 한도(`limitPerRepo`)를 넘어 잘렸는가. */
  truncated: boolean;
  error: string | null;
}

// W5-T1
/** 원격 작업 종류. 워크스페이스 툴바가 여러 저장소 확인 창(W5-T2)에 넘긴다. */
export type RemoteOp = "fetch" | "pull" | "push";

// W5-T4 — 커밋하지 않은 변경(WIP) 파일

/** HEAD와 비교한 작업 트리 파일 상태. 스테이징 여부는 `staged`/`unstaged`로 따로 본다. */
export type WipFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

/** `get_wip_files`의 파일 하나. 목록은 수정 시각이 늦은 순서이고, 삭제된 파일은 맨 뒤에 온다. */
export interface WipFile {
  /** 저장소 루트 기준 경로. 이름을 바꾼 파일은 새 경로. */
  path: string;
  /** 이름을 바꾼 파일의 옛 경로. */
  origPath: string | null;
  status: WipFileStatus;
  /** 스테이징한 변경이 있는지(`StatusEntry.staged`와 같은 뜻). */
  staged: boolean;
  /** 스테이징하지 않은 변경이 있는지. 새 파일도 포함(`StatusEntry.unstaged`와 같은 뜻). */
  unstaged: boolean;
  /**
   * 마지막 수정 시각. 단위는 유닉스 **초**(`StatusEntry.modifiedAt`과 같음).
   * `repo:activity`의 `at` 등 밀리초 값과 비교할 때는 1000을 곱한다. 삭제된 파일은 null.
   */
  modifiedAt: number | null;
  /** HEAD 대비 추가된 줄 수(스테이징 여부 무관). 바이너리이거나 1 MiB 넘는 새 파일이면 null. */
  insertions: number | null;
  /** HEAD 대비 지운 줄 수. `insertions`와 같은 경우에 null. */
  deletions: number | null;
}

// W5-T5 — main 대비 변경

/** `get_changes_vs_default`의 바뀐 파일 하나. */
export interface BranchChangedFile {
  /** 저장소 루트 기준 경로. 지운 파일은 지우기 전 경로. */
  path: string;
  /** 이름을 바꾼 파일의 이전 경로. */
  oldPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
}

/**
 * `get_changes_vs_default`의 결과. 저장소 하나가 main과 갈라진 지점 이후로 바꾼 파일.
 * 여러 저장소는 저장소마다 따로 부른다. 갈라진 지점은 `WorkspaceRepoHistory`와 같은 규칙이다.
 */
export interface BranchChanges {
  path: string;
  branch: string | null;
  headOid: string | null;
  defaultBranch: string | null;
  baseRef: string | null;
  /** `found`가 아니면 `committed`는 비고 `files`는 `uncommitted`와 같다. 커밋이 없는 저장소면 null. */
  baseStatus: WorkspaceBaseStatus | null;
  mergeBaseOid: string | null;
  /**
   * 갈라진 지점 → HEAD. `branch === defaultBranch`면 기준은 upstream(`baseRef`, 예: `origin/main`)이고,
   * 이 목록은 아직 push하지 않은 커밋의 변경이다. 화면은 이 경우를 따로 설명해야 한다.
   */
  committed: BranchChangedFile[];
  /**
   * HEAD → 작업 트리(스테이징·추적하지 않는 파일 포함).
   * `git rm --cached`로 인덱스에서만 뺀 파일은 같은 경로가 `deleted`와 `untracked` 두 번 나온다.
   */
  uncommitted: BranchChangedFile[];
  /** 갈라진 지점 → 작업 트리. 고쳤다가 되돌린 파일은 빠진다. */
  files: BranchChangedFile[];
}

/** `get_file_diff_vs_default`의 결과. 파일 하나를 갈라진 지점 → 작업 트리로 비교한다. */
export interface FileDiffVsDefault extends DiffOutput {
  /** 이름을 바꾼 파일이면 갈라진 지점에서의 경로. */
  oldPath: string | null;
  /** 비교 기준 커밋. 갈라진 지점을 못 찾으면 HEAD, 커밋이 없는 저장소면 null. */
  baseOid: string | null;
  /** false면 갈라진 지점을 못 찾아 HEAD와 비교한 결과다(`BranchChanges.files`와 같은 규칙). */
  baseIsDivergencePoint: boolean;
}

// W5-T2 — 여러 저장소 원격 작업 확인 창(D3)

/** 저장소를 이번 원격 작업에서 뺀 이유. */
export type RemotePlanSkipReason =
  | "upToDate"
  | "noUpstream"
  | "detachedHead"
  | "unborn"
  | "noRemote"
  | "multipleRemotes"
  | "error";

/** `plan_remote_op`의 저장소별 계획. 로컬 상태(마지막 fetch 결과) 기준이다. */
export interface RepoRemotePlan {
  path: string;
  branch: string | null;
  remote: string | null;
  /** 이 저장소에서 실행할 git 명령. 원격 이름만 쓰고 URL·토큰은 넣지 않는다. */
  command: string | null;
  /** Push: 올릴 커밋 수. Pull: 받을 커밋 수. Fetch: 0. */
  commits: number;
  /** 원격 브랜치에 로컬에 없는 커밋이 있다. Push는 먼저 Pull이 필요하다. */
  needsPull: boolean;
  /** Push가 추적 브랜치를 새로 연결한다(`-u`). */
  setsUpstream: boolean;
  skip: boolean;
  skipReason: RemotePlanSkipReason | null;
  /** 마지막 fetch 시각(유닉스 초). */
  fetchedAt: number | null;
  error: string | null;
}
