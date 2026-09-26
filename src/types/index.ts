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
  /** `TokenExpired` only: the account whose GitHub sign-in is missing or expired. */
  accountId?: string;
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
  accounts: GhAccountStatus[];
  versionError?: boolean;
}

/** gh's online token check for one account (`gh auth status`). */
export type GhAuthState = "loggedIn" | "invalid" | "unreachable";

export interface GhAccountStatus {
  username: string;
  active: boolean;
  state: GhAuthState;
  /** OAuth scopes of the token; empty when gh could not check it. */
  scopes: string[];
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

/**
 * 커밋 목록을 어디서부터 읽을지(`get_commit_history`의 `target`).
 * - `head`: 지금 체크아웃한 HEAD(기본값)
 * - `ref`: 로컬 브랜치, 원격 브랜치(`origin/x`), 태그. 체크아웃하지 않고 본다.
 * - `all`: 모든 로컬·원격 브랜치 끝
 */
export type HistoryTarget =
  | { kind: "head" }
  | { kind: "ref"; name: string }
  | { kind: "all" };

export interface BranchInfo {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  /**
   * 기본 브랜치(origin/HEAD → 로컬 main → master)이거나 그 원격 사본(`origin/main`,
   * 로컬 기본 브랜치에 추적 브랜치가 있으면 그것).
   */
  isDefault: boolean;
  upstream: string | null;
  aheadBehind: { ahead: number; behind: number } | null;
  lastCommitTime: number | null;
  isFullyMerged: boolean;
  lastCommitAuthor: { name: string; email: string } | null;
}

/** `get_default_branches`의 한 항목. 저장소를 열지 못하면 `name`·`remoteRef`가 null이다. */
export interface DefaultBranch {
  /** 요청에 넘긴 경로 그대로. */
  path: string;
  /** 기본 브랜치 이름(`main`). origin/HEAD → 로컬 main → master 순으로 찾는다. */
  name: string | null;
  /** 그 이름의 로컬 브랜치가 있다. */
  hasLocal: boolean;
  /** 원격 사본(`origin/main`). 로컬 기본 브랜치의 추적 브랜치, 없으면 `origin/<name>`. */
  remoteRef: string | null;
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
  /**
   * 원격에 없는 커밋 수(`git rev-list HEAD --not --remotes`). 추적 브랜치가 없어도(publish 전) 센다.
   * 원격이 하나도 없는 저장소는 0이다.
   */
  unpushed: number;
  /** working-tree에 커밋되지 않은 변경이 있는지 (RepoInfo.isDirty와 동일 기준, `dirtyCount > 0`). */
  isDirty: boolean;
  /** 커밋하지 않은 파일 수. 추적하지 않는 폴더 안의 파일까지 하나씩 센다. */
  dirtyCount: number;
  /** 커밋하지 않은 파일 중 가장 늦은 수정 시각(epoch ms). 없으면 null. */
  dirtyLatestMtime: number | null;
}

/** HEAD에서 닿지만 어느 원격에도 없는 커밋(`get_unpushed_commits`). */
export interface UnpushedCommits {
  /** 원격에 없는 커밋 수. */
  count: number;
  hasUpstream: boolean;
  hasRemote: boolean;
  /** 앞에서부터 많아야 요청한 개수(최신 순). */
  commits: CommitInfo[];
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
  /** 알림 설정. 옛 설정 파일이나 불러오기 실패로 빠질 수 있어, 없으면 기본값을 쓴다. */
  notifications?: NotificationSettings;
}

/** 알림 설정(Rust: `commands::settings::NotificationSettings`). */
export interface NotificationSettings {
  /** 감시 중인 저장소·워크트리에 새 커밋이 생기면 알린다. */
  newCommits: boolean;
  /** 지금 브랜치의 GitHub Actions 실행이 실패하면 알린다. */
  ciFailures: boolean;
  /** 앱이 앞에 있을 때도 시스템 알림을 보낸다. 끄면 그때는 앱 안 토스트로 알린다. */
  whenFocused: boolean;
}

/** `get_head_advance`: HEAD 가 옛 커밋에서 새 커밋으로 앞으로만 나아갔는지. */
export interface HeadAdvance {
  isDescendant: boolean;
  /** 새로 쌓인 커밋 수(첫 부모 줄기만 — 병합으로 끌어온 커밋은 세지 않는다). 자손이 아니면 0. */
  count: number;
  /** 새 커밋 제목, 최근 것부터 많아야 5개. */
  subjects: string[];
}

export type Theme = "light" | "dark" | "system";

/** `get_environment_info`: 설정 파일 위치와 찾은 git·gh. 못 찾으면 null. */
export interface EnvironmentInfo {
  settingsPath: string;
  gitPath: string | null;
  gitVersion: string | null;
  ghPath: string | null;
  ghVersion: string | null;
}

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

/**
 * 무엇이 바뀌었나. `workTree`: 작업 트리 파일(무시한 파일·빌드 결과 제외).
 * `git`: 그 경로의 커밋·스테이징·브랜치 이동(HEAD, index, `refs/heads/*`). 파일은 그대로일 수 있다.
 */
export type ActivityKind = "workTree" | "git";

/** Payload of the `fs:change` and `fs:git-dir-change` events: the watched repository path. */
export interface FsChangePayload {
  repoPath: string;
}

/** Payload of the `repo:activity` event. */
export interface ActivityEvent {
  path: string;
  /** Epoch ms of the emission. */
  at: number;
  /** 백엔드는 항상 보낸다. 없으면 `workTree`로 본다. */
  kind?: ActivityKind;
}

// W1-T4 — 워크트리 목록 (Rust: src-tauri/src/git/review_worktrees.rs)

/** `review_status`가 돌려주는 워크트리 하나. */
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

// 커밋 범위의 변경(push 안 한 범위)과 main 과 갈라진 지점

/** `get_divergence_point`의 결과. HEAD가 기본 브랜치(main)와 갈라진 지점. */
export interface DivergencePoint {
  /** 체크아웃한 로컬 브랜치. detached HEAD면 null. */
  branch: string | null;
  /** HEAD 커밋. 커밋이 없는 저장소면 null. */
  headOid: string | null;
  defaultBranch: string | null;
  /** 갈라진 지점을 준 참조(`main`, `origin/main`). */
  baseRef: string | null;
  /** 커밋이 없는 저장소면 null. */
  baseStatus: WorkspaceBaseStatus | null;
  /**
   * `baseStatus`가 `found`일 때만 있다. `branch === defaultBranch`면 upstream(`baseRef`, 예: `origin/main`)과의
   * 공통 조상이다(그 위가 아직 push하지 않은 커밋).
   */
  mergeBaseOid: string | null;
}

/** `get_range_changed_files`의 바뀐 파일 하나. 두 커밋의 트리만 비교한다(커밋 안 한 변경은 없다). */
export interface RangeChangedFile {
  /** 저장소 루트 기준 경로. 지운 파일은 지우기 전 경로. */
  path: string;
  /** 이름을 바꾼 파일의 이전 경로. */
  oldPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
  /** 한쪽이 8 MiB를 넘어 줄 단위로 비교하지 않았다. 줄 수는 0이다. */
  tooLarge: boolean;
}

/**
 * 파일 하나를 두 커밋(트리)으로 비교한 줄 단위 diff. `get_range_file_diff`와 PR 파일의 로컬 diff
 * (`get_pull_request_file_diff`)가 돌려준다. 8 MiB를 넘는 파일은 읽지 않는다: `binary`가 true이고
 * `binaryPreview.meta.tooLarge`가 true다.
 */
export interface TreeFileDiff extends DiffOutput {
  /** 이름을 바꾼 파일이면 옛 쪽 경로. */
  oldPath: string | null;
  /** 옛 쪽 커밋. 빈 트리(처음부터)와 비교했으면 null. */
  baseOid: string | null;
  /** 옛 쪽 커밋이 두 커밋의 공통 조상인가. false면 조상이 아닌 커밋과 그대로 비교했다. */
  baseIsMergeBase: boolean;
}

// 원격에 없는 커밋을 파일별로 묶은 것(워크스페이스 리뷰의 「파일별 보기」)

/** 파일 하나를 건드린 커밋 하나. 이 커밋만의 diff는 `getRangeFileDiff(repo, parentOid, oid, path, oldPath)`. */
export interface CommitTouch {
  oid: string;
  shortOid: string;
  /** 커밋 메시지 첫 줄. */
  subject: string;
  /** 작성 시각(유닉스 초). */
  authorTime: number;
  /** 부모(병합 커밋은 목록에 오지 않아 부모는 하나다). 첫 커밋이면 null(빈 트리). */
  parentOid: string | null;
  /** 이 커밋에서의 경로. 뒤에서 이름을 바꿨으면 `FileTouches.path`와 다르다. */
  path: string;
  /** 이 커밋에서 이름을 바꿨으면 이전 경로. */
  oldPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
  /** 한쪽이 8 MiB를 넘어 줄 단위로 비교하지 않았다. 줄 수는 0이다. */
  tooLarge: boolean;
}

/**
 * push하면 바뀌는 파일 하나, 또는 원격에 없는 커밋이 건드렸지만 결과가 base와 같은 파일.
 * 합친 diff는 `getRangeFileDiff(repo, rangeBase, head, path, oldPath)`.
 */
export interface FileTouches {
  /** HEAD 기준 경로. 지운 파일은 지우기 전 경로. 이름을 바꾼 파일은 지금 이름으로 묶인다. */
  path: string;
  /** `rangeBase` → HEAD에서 이름이 바뀌었으면 base 쪽 경로. 내용도 많이 바뀌어 git이 이름 바꾸기로 보지 않으면 null이고 `status`는 `added`다. */
  oldPath: string | null;
  /** `rangeBase` → HEAD의 합친 변경. null이면 커밋들이 건드렸지만 결과가 base와 같다(넣었다 되돌림). */
  status: FileStatus | null;
  /** `rangeBase` → HEAD의 줄 수. `status`가 null이면 0. */
  additions: number;
  deletions: number;
  isBinary: boolean;
  tooLarge: boolean;
  /** 이 파일을 건드린 원격에 없는 병합 아닌 커밋, 최신 순. 비어 있으면 병합 커밋에서만 바뀌었다(충돌 해결 등). */
  commits: CommitTouch[];
}

/**
 * `get_unpushed_file_touches`의 저장소(워크트리) 하나. 파일 목록은 push하면 바뀌는 것(`rangeBase` → HEAD)이고,
 * 파일마다의 커밋은 원격에 없는 커밋(`git rev-list HEAD --not --remotes`) 중 병합 아닌 커밋이다.
 * `git pull`로 병합해 들어온 동료의 변경은 원격에 이미 있어 목록에 없다.
 */
export interface RepoFileTouches {
  /** 요청에 넘긴 경로 그대로. */
  path: string;
  /** 이 저장소를 읽지 못한 이유. 있으면 나머지는 비어 있다. */
  error: string | null;
  /** 원격에 없는 커밋이 500개를 넘어 최신 500개만 읽었다. 파일별 커밋 목록은 읽은 커밋만 담는다. */
  truncated: boolean;
  /**
   * 합친 diff의 옛 쪽. 추적 브랜치가 있으면 HEAD와 그 끝의 공통 조상(pull한 뒤면 추적 브랜치 끝). 없으면
   * `origin/<기본 브랜치>`와의 공통 조상과, 첫 부모를 따라 내려가 처음 만나는 원격에 있는 커밋 중 HEAD에 가까운 쪽.
   * 원격에 없는 커밋이 없으면 `head`와 같다. 처음 커밋까지 원격에 없으면 null(빈 트리와 비교).
   */
  rangeBase: string | null;
  /** HEAD 커밋. 커밋이 없는 저장소면 null. */
  head: string | null;
  /** 읽은 커밋 중 병합 커밋 수. 이 커밋들은 파일별 커밋 목록에 없다. */
  merges: number;
  /** 커밋 2개 이상이 건드린 파일 먼저, 그다음 파일의 커밋 중 가장 늦은 작성 시각 순(`latestTouchTime`), 그다음 경로 순. */
  files: FileTouches[];
}

// W5-T2 — 여러 저장소 원격 작업 확인 창(D3)

/** 저장소를 이번 원격 작업에서 뺀 이유. */
export type RemotePlanSkipReason =
  | "upToDate"
  | "noUpstream"
  /** Pull: 추적 브랜치는 설정돼 있지만 원격 브랜치가 사라졌다. */
  | "upstreamGone"
  /** Pull: 추적 브랜치는 설정돼 있지만 이 클론(`--single-branch` 등)이 그 브랜치를 받지 않는다. */
  | "notTracked"
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
  /** 원격 브랜치에만 있는 커밋 수(마지막 fetch 기준). */
  behind: number;
  /** 원격 브랜치에 로컬에 없는 커밋이 있다. Push는 먼저 Pull이 필요하다. */
  needsPull: boolean;
  /** Push가 추적 브랜치를 새로 연결한다(`-u`). */
  setsUpstream: boolean;
  skip: boolean;
  skipReason: RemotePlanSkipReason | null;
  /** 마지막으로 성공한 fetch 시각(유닉스 초). 모르면 null. */
  fetchedAt: number | null;
  error: string | null;
}

// W5-T3
/** `branch_bases`의 한 행. 기반 브랜치를 모르거나 계산하지 않는 브랜치(기본·원격)는 `base`가 null. */
export interface BranchBaseInfo {
  name: string;
  base: WorktreeBase | null;
  /**
   * 이 브랜치의 커밋이 merge로 기반 브랜치에 들어갔다(지워도 잃는 커밋이 없다). 커밋 없이
   * 기반보다 뒤처지기만 한 브랜치나 fast-forward로 들어간 브랜치는 false.
   */
  mergedIntoBase: boolean;
}

// Read-only PR viewer — shapes of `commands/pull_request.rs`
/** 목록 필터. 닫힌 목록에는 병합한 PR도 들어간다. */
export type PrStateFilter = "open" | "closed" | "all";
export type PrState = "open" | "closed" | "merged";
/** 리뷰 규칙이 정한 판정. 규칙이 없으면 null. */
export type PrReviewDecision = "approved" | "changes_requested" | "review_required";
/** 마지막 커밋의 CI 종합. 체크가 없으면 null. */
export type PrCiState = "success" | "failure" | "error" | "pending" | "expected";

export interface PrUser {
  login: string;
  avatarUrl: string | null;
}

export interface PrLabel {
  name: string;
  /** 16진 색(`#` 없이). */
  color: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  state: PrState;
  isDraft: boolean;
  author: PrUser;
  headRef: string;
  baseRef: string;
  headSha: string;
  /** 포크에서 온 PR. 이 저장소 원격에는 head 브랜치가 없다. */
  isCrossRepository: boolean;
  headRepo: string | null;
  reviewDecision: PrReviewDecision | null;
  ciState: PrCiState | null;
  commentCount: number;
  threadCount: number;
  labels: PrLabel[];
  createdAt: string;
  updatedAt: string;
}

export interface PrReviewer {
  login: string;
  avatarUrl: string | null;
  state: "approved" | "changes_requested" | "commented" | "dismissed" | "pending" | "requested";
  isTeam: boolean;
}

export interface PrCommit {
  oid: string;
  headline: string;
  authorName: string;
  author: PrUser | null;
  authoredAt: string;
}

export interface PrCheck {
  name: string;
  /** `completed` | `in_progress` | `queued` | `pending` 등. */
  status: string;
  /** 끝난 체크의 결과: `success` | `failure` | `neutral` | `cancelled` | `skipped` | `timed_out` 등. */
  conclusion: string | null;
  url: string | null;
  description: string | null;
}

export interface PrConversationItem {
  kind: "comment" | "review";
  id: string;
  author: PrUser;
  body: string;
  createdAt: string;
  url: string;
  reviewState: "approved" | "changes_requested" | "commented" | "dismissed" | null;
}

export interface PrThreadComment {
  id: string;
  author: PrUser;
  body: string;
  createdAt: string;
  url: string;
}

export interface PrReviewThread {
  id: string;
  path: string;
  /** 지금 diff에서의 줄 번호(`side` 쪽). 자리를 잃었으면(outdated) null. */
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  /** `left`: 지운 쪽(옛 줄 번호), `right`: 새 쪽(새 줄 번호). */
  side: "left" | "right";
  isResolved: boolean;
  isOutdated: boolean;
  diffHunk: string;
  comments: PrThreadComment[];
  commentsTruncated: boolean;
}

export interface PrTruncation {
  commits: boolean;
  comments: boolean;
  reviews: boolean;
  threads: boolean;
  checks: boolean;
}

export interface PullRequestDetail extends PullRequestSummary {
  body: string;
  baseSha: string;
  mergedAt: string | null;
  closedAt: string | null;
  mergeable: "mergeable" | "conflicting" | "unknown";
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewers: PrReviewer[];
  commits: PrCommit[];
  commitCount: number;
  checks: PrCheck[];
  conversation: PrConversationItem[];
  threads: PrReviewThread[];
  truncated: PrTruncation;
  /** base·head 커밋이 로컬에 있어 파일 diff를 로컬 git으로 만든다. */
  localDiff: boolean;
}

export type PrFileStatus = "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";

export interface PrFile {
  path: string;
  oldPath: string | null;
  status: PrFileStatus;
  additions: number;
  deletions: number;
  /** GitHub patch를 화면 모양으로 바꾼 것. 바이너리이거나 너무 커서 patch가 없으면 null. */
  hunks: DiffHunk[] | null;
}

export interface PrFiles {
  files: PrFile[];
  /** 1000개까지만 읽었다. */
  truncated: boolean;
}
