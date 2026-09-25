import { invoke } from "@tauri-apps/api/core";
import type {
  StatusEntry,
  FileStatus,
  DiffOutput,
  BinaryPreview,
  RepoInfo,
  BranchInfo,
  BranchDivergence,
  RepoSyncStatus,
  UnpushedCommits,
  CommitInfo,
  CoAuthor,
  RefLabel,
  GitHubAccount,
  GhStatus,
  AppSettings,
  Theme,
  EditorInfo,
  TerminalInfo,
  AiCliInfo,
  BranchCompareResult,
  MergeStrategy,
  MergePreCheckResult,
  WorktreeInfo,
  StashEntry,
  StashShowResult,
  PushTarget,
  AutoSyncSnapshot,
  AutoFastForwardResult,
  ActivityWatchResult,
  HistoryTarget,
} from "@/types";

// Git operations — backend returns indexStatus/worktreeStatus separately,
// but the frontend StatusEntry expects a single `status` field.

interface RawStatusEntry {
  path: string;
  /** Source path of a rename/copy detected by `git status`. */
  origPath: string | null;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
  indexStatus: string;
  worktreeStatus: string;
  modifiedAt: number | null;
  insertions: number | null;
  deletions: number | null;
  sizeBytes: number | null;
}

export async function getStatus(repoPath: string): Promise<StatusEntry[]> {
  const raw: RawStatusEntry[] = await invoke("get_status", { repoPath });
  const entries: StatusEntry[] = [];

  for (const entry of raw) {
    // A conflicted (unmerged) file has neither staged nor unstaged flags set,
    // so it must be surfaced explicitly or it would be dropped entirely.
    if (entry.conflicted) {
      entries.push({
        path: entry.path,
        status: "conflicted",
        staged: false,
        modifiedAt: entry.modifiedAt,
        insertions: entry.insertions,
        deletions: entry.deletions,
        sizeBytes: entry.sizeBytes,
      });
      continue;
    }
    // Only renames carry origPath: a copy's source is a separate file with its
    // own row, and acting on it from the copy row would touch its changes.
    const indexRenamed = entry.indexStatus === "renamed";
    const worktreeRenamed = entry.worktreeStatus === "renamed";
    if (entry.staged && entry.indexStatus !== "unchanged") {
      entries.push({
        path: entry.path,
        origPath: indexRenamed ? entry.origPath : null,
        status: entry.indexStatus as FileStatus,
        staged: true,
        modifiedAt: entry.modifiedAt,
        insertions: entry.insertions,
        deletions: entry.deletions,
        sizeBytes: entry.sizeBytes,
      });
    }
    if (entry.unstaged && entry.worktreeStatus !== "unchanged") {
      entries.push({
        path: entry.path,
        origPath: !indexRenamed && worktreeRenamed ? entry.origPath : null,
        status: entry.worktreeStatus as FileStatus,
        staged: false,
        modifiedAt: entry.modifiedAt,
        insertions: entry.insertions,
        deletions: entry.deletions,
        sizeBytes: entry.sizeBytes,
      });
    }
  }

  return entries;
}

export async function stageFiles(repoPath: string, paths: string[]): Promise<void> {
  return invoke("stage_files", { repoPath, paths });
}

export async function unstageFiles(repoPath: string, paths: string[]): Promise<void> {
  return invoke("unstage_files", { repoPath, paths });
}

export async function createCommit(
  repoPath: string,
  message: string,
  amend = false,
  accountId?: string | null,
): Promise<string> {
  return invoke("create_commit", { repoPath, message, amend, accountId: accountId ?? null });
}

export async function getDiff(repoPath: string, staged: boolean): Promise<DiffOutput> {
  return invoke("get_diff", { repoPath, staged });
}

/**
 * Discard changes to `paths`. With `staged` false only the unstaged changes are
 * dropped (restored from the index); with `staged` true the files return to
 * their HEAD state. Untracked and index-only files are moved to the Trash.
 */
export async function discardChanges(
  repoPath: string,
  paths: string[],
  staged: boolean,
): Promise<void> {
  return invoke("discard_changes", { repoPath, paths, staged });
}

/** Paths among `paths` whose file still contains `<<<<<<<`/`>>>>>>>` conflict markers. */
export async function findConflictMarkers(repoPath: string, paths: string[]): Promise<string[]> {
  return invoke("find_conflict_markers", { repoPath, paths });
}

export async function addToGitignore(repoPath: string, pattern: string): Promise<void> {
  return invoke("add_to_gitignore", { repoPath, pattern });
}

// ── Commit operations (checkout/reset/revert/cherry-pick) ────────────────────

export async function checkoutCommit(repoPath: string, oid: string): Promise<void> {
  return invoke("checkout_commit", { repoPath, oid });
}

export type ResetMode = "soft" | "mixed" | "hard";

export async function resetToCommit(repoPath: string, oid: string, mode: ResetMode): Promise<void> {
  return invoke("reset_to_commit", { repoPath, oid, mode });
}

export async function revertCommit(
  repoPath: string,
  oid: string,
  accountId: string | null,
): Promise<void> {
  return invoke("revert_commit", { repoPath, oid, accountId });
}

export async function cherryPickCommit(
  repoPath: string,
  oid: string,
  accountId: string | null,
): Promise<void> {
  return invoke("cherry_pick_commit", { repoPath, oid, accountId });
}

/**
 * @param automatic 사용자가 직접 누른 fetch가 아니라 앱이 알아서 도는 fetch면 true.
 *   성공한 자동 fetch는 활동 로그에 남지 않는다.
 */
export async function gitFetch(
  repoPath: string,
  accountId: string,
  automatic = false,
): Promise<void> {
  return invoke("git_fetch", { repoPath, accountId, automatic });
}

export async function gitPush(
  repoPath: string,
  accountId: string,
  force = false,
): Promise<void> {
  return invoke("git_push", { repoPath, accountId, force });
}

/** `rebase`를 생략하면 사용자의 `pull.rebase` 설정을 따른다(없으면 merge). */
/** push가 실제로 올릴 원격과 refspec. force push 확인 창에 보여준다. */
export async function getPushTarget(repoPath: string): Promise<PushTarget> {
  return invoke("get_push_target", { repoPath });
}

export async function gitPull(
  repoPath: string,
  accountId: string,
  rebase?: boolean,
): Promise<void> {
  return invoke("git_pull", { repoPath, accountId, rebase });
}

/** 자동 fast-forward 판단용 저장소 상태. fetch가 끝난 뒤 호출한다. */
export async function getAutoSyncSnapshot(repoPath: string): Promise<AutoSyncSnapshot> {
  return invoke("get_auto_sync_snapshot", { repoPath });
}

/**
 * 현재 브랜치를 upstream으로 fast-forward한다(`git merge --ff-only`, 훅 실행).
 * 백엔드가 조건을 한 번 더 확인하고, 맞지 않으면 commits 0으로 건너뛴다.
 */
export async function autoFastForward(repoPath: string): Promise<AutoFastForwardResult> {
  return invoke("auto_fast_forward", { repoPath });
}

/** Tag names that exist on origin — used to flag local-only tags in history. */
export async function listRemoteTags(
  repoPath: string,
  accountId: string,
): Promise<string[]> {
  return invoke("list_remote_tags", { repoPath, accountId });
}

// Repository
export async function openRepository(path: string): Promise<RepoInfo> {
  return invoke("open_repository", { path });
}

export async function cloneRepository(
  url: string,
  path: string,
  accountId?: string,
): Promise<RepoInfo> {
  return invoke("clone_repository", { url, path, accountId: accountId ?? null });
}

// GitHub repo search
export interface GitHubRepoSearchResult {
  fullName: string;
  cloneUrl: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
}

export async function searchGithubRepos(
  accountId: string,
  query: string,
): Promise<GitHubRepoSearchResult[]> {
  return invoke("search_github_repos", { accountId, query });
}

export async function getOpenRepos(): Promise<RepoInfo[]> {
  return invoke("get_open_repos");
}

export async function closeRepository(path: string): Promise<void> {
  return invoke("close_repository", { path });
}

export async function addLocalRepository(path: string): Promise<RepoInfo> {
  return invoke("add_local_repository", { path });
}

// Repository visibility
export interface RepoVisibility {
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  ownerType: "User" | "Organization";
}

export async function getRepoVisibility(
  repoPath: string,
  accountId: string,
): Promise<RepoVisibility> {
  return invoke("get_repo_visibility", { repoPath, accountId });
}

// Owner type (org vs user)
export async function getOwnerType(
  owner: string,
  accountId: string,
): Promise<{ ownerType: "User" | "Organization" }> {
  return invoke("get_owner_type", { owner, accountId });
}

// Branches
export async function getBranches(repoPath: string): Promise<BranchInfo[]> {
  return invoke("get_branches", { repoPath });
}

/** HEAD points at a commit, not a branch. An unborn (orphan) branch is not detached. */
export async function isHeadDetached(repoPath: string): Promise<boolean> {
  return invoke("is_head_detached", { repoPath });
}

export async function getBranchDivergence(repoPath: string): Promise<BranchDivergence[]> {
  return invoke("get_branch_divergence", { repoPath });
}

export async function getRepoSyncStatus(repoPaths: string[]): Promise<RepoSyncStatus[]> {
  return invoke("repo_sync_status", { repoPaths });
}

/** 원격에 없는 커밋(`git rev-list HEAD --not --remotes`). 목록은 앞에서 `limit`개까지. */
export async function getUnpushedCommits(repoPath: string, limit?: number): Promise<UnpushedCommits> {
  return invoke("get_unpushed_commits", { repoPath, limit });
}

export async function createBranch(
  repoPath: string,
  name: string,
  from?: string,
): Promise<void> {
  return invoke("create_branch", { repoPath, name, from });
}

export async function switchBranch(repoPath: string, name: string): Promise<void> {
  return invoke("switch_branch", { repoPath, name });
}

export async function deleteBranch(repoPath: string, name: string): Promise<void> {
  return invoke("delete_branch", { repoPath, name });
}

export async function renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
  return invoke("rename_branch", { repoPath, oldName, newName });
}

export async function getRecentBranches(repoPath: string, limit: number): Promise<string[]> {
  return invoke("get_recent_branches", { repoPath, limit });
}

export async function getCurrentBranch(repoPath: string): Promise<string | null> {
  return invoke("get_current_branch", { repoPath });
}

export async function compareBranches(
  repoPath: string,
  baseBranch: string,
  compareBranch: string,
): Promise<BranchCompareResult> {
  return invoke("compare_branches", { repoPath, baseBranch, compareBranch });
}

export async function mergeBranch(
  repoPath: string,
  branch: string,
  strategy: MergeStrategy,
  accountId: string | null,
): Promise<string> {
  return invoke("merge_branch_into_current", { repoPath, branch, strategy, accountId });
}

export async function checkMergeConflicts(
  repoPath: string,
  branch: string,
): Promise<MergePreCheckResult> {
  return invoke("check_merge_conflicts", { repoPath, branch });
}

import type { GitOperation } from "@/types";

/** The operation currently in progress, if any. */
export async function getMergeState(repoPath: string): Promise<GitOperation | null> {
  return invoke("get_merge_state", { repoPath });
}

export async function abortMergeOrRebase(repoPath: string): Promise<void> {
  return invoke("abort_merge_or_rebase", { repoPath });
}

export async function continueMergeOrRebase(
  repoPath: string,
  accountId: string | null,
): Promise<void> {
  return invoke("continue_merge_or_rebase", { repoPath, accountId });
}

export async function getConflictFileDiff(
  repoPath: string,
  branch: string,
  filePath: string,
): Promise<DiffOutput> {
  const raw: RawFileDiff = await invoke("get_conflict_file_diff", { repoPath, branch, filePath });
  return {
    filePath: raw.filePath,
    oldContent: raw.oldContent ?? "",
    newContent: raw.newContent ?? "",
    binary: raw.binary ?? false,
    binaryPreview: raw.binaryPreview,
    hunks: raw.hunks.map((h) => ({
      header: h.header,
      oldStart: h.oldStart,
      oldLines: h.lines.filter((l) => l.kind !== "addition").length,
      newStart: h.newStart,
      newLines: h.lines.filter((l) => l.kind !== "deletion").length,
      lines: h.lines.map((l) => ({
        content: l.content,
        lineType: mapLineKind(l.kind),
        oldLineNo: l.oldLineNo,
        newLineNo: l.newLineNo,
      })),
    })),
  };
}

// Stash
/** Stashes all changes, untracked files included. Resolves to the created stash's oid, or null when there was nothing to stash. */
export async function stashPush(repoPath: string, message?: string): Promise<string | null> {
  return invoke("stash_push", { repoPath, message });
}

export async function stashPop(repoPath: string, index: number): Promise<void> {
  return invoke("stash_pop", { repoPath, index });
}

/** Pops the stash a `stashPush` returned, wherever it now sits in the list. */
export async function stashPopByOid(repoPath: string, oid: string): Promise<void> {
  return invoke("stash_pop_by_oid", { repoPath, oid });
}

export async function stashList(repoPath: string): Promise<StashEntry[]> {
  return invoke("stash_list", { repoPath });
}

export async function stashApply(repoPath: string, index: number): Promise<void> {
  return invoke("stash_apply", { repoPath, index });
}

export async function stashDrop(repoPath: string, index: number): Promise<void> {
  return invoke("stash_drop", { repoPath, index });
}

export async function stashShow(repoPath: string, index: number): Promise<StashShowResult> {
  return invoke("stash_show", { repoPath, index });
}

export async function stashPushPartial(repoPath: string, paths: string[], message?: string): Promise<string | null> {
  return invoke("stash_push_partial", { repoPath, paths, message });
}

// History — backend returns raw fields (oid, parents, etc.)
// that differ from the frontend CommitInfo type, so we map here.

interface RawAuthor {
  name: string;
  email: string;
  avatarUrl?: string;
}

interface RawCommitHistory {
  oid: string;
  message: string;
  summary: string;
  author: RawAuthor;
  timestamp: number;
  parentCount: number;
  parentIds: string[];
  refs: RefLabel[];
  isUnpushed: boolean;
  coAuthors: CoAuthor[];
  isAgentAuthored: boolean;
}

interface RawCommitDetailFile {
  oldPath: string | null;
  newPath: string | null;
  status: string;
}

interface RawCommitDetailDiff {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: RawCommitDetailFile[];
}

interface RawCommitDetail {
  oid: string;
  message: string;
  summary: string;
  author: RawAuthor;
  committer: RawAuthor;
  timestamp: number;
  parents: string[];
  coAuthors: CoAuthor[];
  isAgentAuthored: boolean;
  diff: RawCommitDetailDiff;
}

export interface CommitChangedFile {
  path: string;
  oldPath: string | null;
  status: FileStatus;
}

export interface CommitDetailResult {
  commit: CommitInfo;
  changedFiles: CommitChangedFile[];
  stats: { filesChanged: number; insertions: number; deletions: number };
}

/** `target`을 빼면 HEAD(지금 체크아웃)의 이력이다. */
export async function getCommitHistory(
  repoPath: string,
  limit = 50,
  offset = 0,
  target?: HistoryTarget,
): Promise<CommitInfo[]> {
  const raw: RawCommitHistory[] = await invoke("get_commit_history", {
    repoPath,
    limit,
    offset,
    ...(target && target.kind !== "head" ? { target } : {}),
  });
  return raw.map((c) => ({
    id: c.oid,
    shortId: c.oid.slice(0, 7),
    message: c.message,
    summary: c.summary,
    author: c.author,
    committer: c.author,
    timestamp: c.timestamp,
    parentIds: c.parentIds,
    refs: c.refs,
    isUnpushed: c.isUnpushed,
    coAuthors: c.coAuthors,
    isAgentAuthored: c.isAgentAuthored,
  }));
}

function mapCommitStatus(raw: string): FileStatus {
  const lower = raw.toLowerCase();
  if (lower === "added") return "added";
  if (lower === "deleted") return "deleted";
  if (lower === "renamed") return "renamed";
  if (lower === "copied") return "copied";
  return "modified";
}

export async function getCommitDetail(
  repoPath: string,
  oid: string,
): Promise<CommitDetailResult> {
  const c: RawCommitDetail = await invoke("get_commit_detail", { repoPath, oid });
  return {
    commit: {
      id: c.oid,
      shortId: c.oid.slice(0, 7),
      message: c.message,
      summary: c.summary,
      author: c.author,
      committer: c.committer,
      timestamp: c.timestamp,
      parentIds: c.parents,
      refs: [],
      coAuthors: c.coAuthors,
      isAgentAuthored: c.isAgentAuthored,
    },
    changedFiles: (c.diff?.files ?? []).map((f) => ({
      path: f.newPath ?? f.oldPath ?? "",
      oldPath: f.oldPath,
      status: mapCommitStatus(f.status),
    })),
    stats: {
      filesChanged: c.diff?.filesChanged ?? 0,
      insertions: c.diff?.insertions ?? 0,
      deletions: c.diff?.deletions ?? 0,
    },
  };
}

export async function getCommitFileDiff(
  repoPath: string,
  oid: string,
  filePath: string,
): Promise<DiffOutput> {
  const raw: RawFileDiff = await invoke("get_commit_file_diff", { repoPath, oid, filePath });
  return {
    filePath: raw.filePath,
    oldContent: raw.oldContent ?? "",
    newContent: raw.newContent ?? "",
    binary: raw.binary ?? false,
    binaryPreview: raw.binaryPreview,
    hunks: raw.hunks.map((h) => ({
      header: h.header,
      oldStart: h.oldStart,
      oldLines: h.lines.filter((l) => l.kind !== "addition").length,
      newStart: h.newStart,
      newLines: h.lines.filter((l) => l.kind !== "deletion").length,
      lines: h.lines.map((l) => ({
        content: l.content,
        lineType: mapLineKind(l.kind),
        oldLineNo: l.oldLineNo,
        newLineNo: l.newLineNo,
      })),
    })),
  };
}

// Commit avatars — resolve GitHub avatar URLs for commit authors

export async function resolveCommitAvatars(
  repoPath: string,
): Promise<Record<string, string>> {
  try {
    return await invoke("resolve_commit_avatars", { repoPath });
  } catch {
    return {};
  }
}

// Auth — gh CLI based

export async function checkGhStatus(): Promise<GhStatus> {
  return invoke("check_gh_status");
}

/** Starts `gh auth login` in the background. Resolves to the login id for `cancelGhLogin`. */
export async function startGhLogin(): Promise<number> {
  return invoke("start_gh_login");
}

/** Kills the `gh auth login` process started with `loginId`, if it is still running. */
export async function cancelGhLogin(loginId: number): Promise<void> {
  return invoke("cancel_gh_login", { loginId });
}

interface RawAccount {
  id: string;
  login?: string;
  username?: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  avatar_url?: string;
}

export async function getAccounts(): Promise<GitHubAccount[]> {
  const raw: RawAccount[] = await invoke("get_accounts");
  return raw.map((a) => ({
    id: a.id,
    username: a.login ?? a.username ?? a.name ?? "",
    email: a.email ?? "",
    avatarUrl: a.avatarUrl ?? a.avatar_url ?? "",
  }));
}

export async function removeAccount(accountId: string): Promise<void> {
  return invoke("remove_account", { accountId });
}

export async function setRepoAccount(
  repoPath: string,
  remoteName: string,
  accountId: string,
): Promise<void> {
  return invoke("set_repo_account", { repoPath, remoteName, accountId });
}

export async function getRepoAccount(
  repoPath: string,
  remoteName: string,
): Promise<GitHubAccount | null> {
  const raw: RawAccount | null = await invoke("get_repo_account", { repoPath, remoteName });
  if (!raw) return null;
  return {
    id: raw.id,
    username: raw.login ?? raw.username ?? raw.name ?? "",
    email: raw.email ?? "",
    avatarUrl: raw.avatarUrl ?? raw.avatar_url ?? "",
  };
}

export interface TokenValidation {
  valid: boolean;
  /** null when push access cannot be checked (the remote is not on github.com). */
  canPush: boolean | null;
  reason?: string;
}

export async function validateToken(accountId: string, repoPath?: string): Promise<TokenValidation> {
  return invoke("validate_token", { accountId, repoPath: repoPath ?? null });
}

// Diff — backend returns `kind` ("addition"/"deletion"/"context") but
// the frontend DiffOutput type expects `lineType` ("add"/"delete"/"context").

interface RawDiffLine {
  kind: string;
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

interface RawDiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: RawDiffLine[];
}

interface RawFileDiff {
  filePath: string;
  staged: boolean;
  binary: boolean;
  insertions: number;
  deletions: number;
  hunks: RawDiffHunk[];
  oldContent: string;
  newContent: string;
  binaryPreview?: BinaryPreview;
}

function mapLineKind(kind: string): "add" | "delete" | "context" {
  if (kind === "addition") return "add";
  if (kind === "deletion") return "delete";
  return "context";
}

export async function getFileDiff(
  repoPath: string,
  filePath: string,
  staged: boolean,
): Promise<DiffOutput> {
  const raw: RawFileDiff = await invoke("get_file_diff", { repoPath, filePath, staged });
  return {
    filePath: raw.filePath,
    oldContent: raw.oldContent ?? "",
    newContent: raw.newContent ?? "",
    binary: raw.binary ?? false,
    binaryPreview: raw.binaryPreview,
    hunks: raw.hunks.map((h) => ({
      header: h.header,
      oldStart: h.oldStart,
      oldLines: h.lines.filter((l) => l.kind !== "addition").length,
      newStart: h.newStart,
      newLines: h.lines.filter((l) => l.kind !== "deletion").length,
      lines: h.lines.map((l) => ({
        content: l.content,
        lineType: mapLineKind(l.kind),
        oldLineNo: l.oldLineNo,
        newLineNo: l.newLineNo,
      })),
    })),
  };
}

// Settings
export async function getSettings(): Promise<AppSettings> {
  return invoke("get_settings");
}

export async function updateSettings(settings: AppSettings): Promise<void> {
  return invoke("update_settings", { settings });
}

export async function getTheme(): Promise<Theme> {
  return invoke("get_theme");
}

export async function setTheme(theme: Theme): Promise<void> {
  return invoke("set_theme", { theme });
}

// Editors
export async function detectInstalledEditors(): Promise<EditorInfo[]> {
  return invoke("detect_installed_editors");
}

export async function openInEditor(repoPath: string, filePath: string): Promise<void> {
  return invoke("open_in_editor", { repoPath, filePath });
}

// Repository context menu actions
export async function revealInFinder(path: string): Promise<void> {
  return invoke("reveal_in_finder", { path });
}

export async function openInTerminal(repoPath: string): Promise<void> {
  return invoke("open_in_terminal", { repoPath });
}

export async function openRepoInEditor(repoPath: string): Promise<void> {
  return invoke("open_repo_in_editor", { repoPath });
}

// Terminals
export async function detectInstalledTerminals(): Promise<TerminalInfo[]> {
  return invoke("detect_installed_terminals");
}

// AI CLIs
export async function detectInstalledAiClis(): Promise<AiCliInfo[]> {
  return invoke("detect_installed_ai_clis");
}

export async function openAiCliInTerminal(repoPath: string, cliId: string): Promise<void> {
  return invoke("open_ai_cli_in_terminal", { repoPath, cliId });
}

// Worktrees
export async function getWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return invoke("get_worktrees", { repoPath });
}

export async function addWorktree(
  repoPath: string,
  path: string,
  branch?: string,
  newBranch?: string,
  baseBranch?: string,
): Promise<void> {
  return invoke("add_worktree", {
    repoPath,
    path,
    branch: branch ?? null,
    newBranch: newBranch ?? null,
    baseBranch: baseBranch ?? null,
  });
}

export async function removeWorktree(
  repoPath: string,
  path: string,
  force = false,
): Promise<void> {
  return invoke("remove_worktree", { repoPath, path, force });
}

// ── Actions (GitHub Actions) ──

import type { WorkflowRun, WorkflowJob } from "@/types";

export async function listWorkflowRuns(
  repoPath: string,
  accountId: string,
): Promise<WorkflowRun[]> {
  return invoke("list_workflow_runs", { repoPath, accountId });
}

export async function getWorkflowRunJobs(
  repoPath: string,
  accountId: string,
  runId: number,
): Promise<WorkflowJob[]> {
  return invoke("get_workflow_run_jobs", { repoPath, accountId, runId });
}

// ── FS Watcher ──

export async function startRepoWatch(repoPath: string, token: number): Promise<void> {
  return invoke("start_repo_watch", { repoPath, token });
}

export async function stopRepoWatch(token: number): Promise<void> {
  return invoke("stop_repo_watch", { token });
}

// W1-T3 — 여러 저장소 활동 감시
export async function setActivityWatch(paths: string[]): Promise<ActivityWatchResult> {
  return invoke("set_activity_watch", { paths });
}

// ── W1-T4 워크트리 목록 ──

import type { RepoReviewStatus } from "@/types";

/** 저장소마다 워크트리 목록(메인 포함)과 각 워크트리의 브랜치·HEAD. */
export async function reviewStatus(repoPaths: string[]): Promise<RepoReviewStatus[]> {
  return invoke("review_status", { repoPaths });
}

// W4-T2 — 워크스페이스 타임라인

import type { WorkspaceRepoHistory } from "@/types";

type RawWorkspaceCommit = Omit<CommitInfo, "author" | "committer"> & {
  author: RawAuthor;
  committer: RawAuthor;
};

interface RawWorkspaceRepoHistory
  extends Omit<WorkspaceRepoHistory, "commits" | "mergeBaseCommit"> {
  commits: RawWorkspaceCommit[];
  mergeBaseCommit: RawWorkspaceCommit | null;
}

function workspaceCommitFromRaw(c: RawWorkspaceCommit): CommitInfo {
  return {
    ...c,
    shortId: c.id.slice(0, 7),
    author: { name: c.author.name, email: c.author.email },
    committer: { name: c.committer.name, email: c.committer.email },
  };
}

/**
 * 저장소마다 HEAD부터 main과 갈라진 지점까지의 커밋. 결과는 `paths` 순서와 같고,
 * 한 저장소가 실패해도 나머지는 돌아온다(`error` 참고). `limitPerRepo`는 1~1000, 기본 100.
 */
export async function getWorkspaceHistory(
  paths: string[],
  limitPerRepo?: number,
): Promise<WorkspaceRepoHistory[]> {
  const raw: RawWorkspaceRepoHistory[] = await invoke("get_workspace_history", {
    paths,
    limitPerRepo,
  });
  return raw.map((repo) => ({
    ...repo,
    commits: repo.commits.map(workspaceCommitFromRaw),
    mergeBaseCommit: repo.mergeBaseCommit && workspaceCommitFromRaw(repo.mergeBaseCommit),
  }));
}

// W5-T4 — 커밋하지 않은 변경(WIP) 파일

import type { WipFile } from "@/types";

/** 저장소(또는 워크트리) 하나의 커밋하지 않은 변경 파일. 수정 시각이 늦은 순서, 삭제된 파일은 맨 뒤. */
export async function getWipFiles(path: string): Promise<WipFile[]> {
  return invoke("get_wip_files", { path });
}

// W5-T5 — main 대비 변경

import type { BranchChanges, ChangesScope, FileDiffVsDefault } from "@/types";

/** 범위 인자 중 정한 것만 넘긴다(없으면 백엔드 기본값: 기본 브랜치 대비, HEAD + 작업 트리). */
function scopeArgs(scope?: ChangesScope): Partial<ChangesScope> {
  return {
    ...(scope?.base ? { base: scope.base } : {}),
    ...(scope?.target ? { target: scope.target } : {}),
  };
}

/**
 * 저장소 하나가 main(또는 `scope.base`)과 갈라진 지점 이후로 바꾼 파일과 커밋 안 한 변경.
 * `scope.target`을 주면 체크아웃하지 않고 그 브랜치를 본다. 저장소마다 따로 부른다.
 */
export async function getChangesVsDefault(path: string, scope?: ChangesScope): Promise<BranchChanges> {
  return invoke("get_changes_vs_default", { path, ...scopeArgs(scope) });
}

interface RawFileDiffVsDefault extends Omit<RawFileDiff, "staged" | "binaryPreview"> {
  oldPath: string | null;
  baseOid: string | null;
  baseIsDivergencePoint: boolean;
}

/** 줄 단위 diff 원본을 화면용 `DiffOutput` 모양으로 바꾼다. */
function fileDiffVsDefaultFromRaw(raw: RawFileDiffVsDefault): FileDiffVsDefault {
  return {
    filePath: raw.filePath,
    oldPath: raw.oldPath,
    oldContent: raw.oldContent,
    newContent: raw.newContent,
    binary: raw.binary,
    baseOid: raw.baseOid,
    baseIsDivergencePoint: raw.baseIsDivergencePoint,
    hunks: raw.hunks.map((h) => ({
      header: h.header,
      oldStart: h.oldStart,
      oldLines: h.lines.filter((l) => l.kind !== "addition").length,
      newStart: h.newStart,
      newLines: h.lines.filter((l) => l.kind !== "deletion").length,
      lines: h.lines.map((l) => ({
        content: l.content,
        lineType: mapLineKind(l.kind),
        oldLineNo: l.oldLineNo,
        newLineNo: l.newLineNo,
      })),
    })),
  };
}

/**
 * 파일 하나를 그 저장소 main과 갈라진 지점 → 작업 트리로 비교한 줄 단위 diff.
 * `oldPath`에는 `BranchChangedFile.oldPath`(이름을 바꾼 파일의 이전 경로)를 넘긴다.
 */
export async function getFileDiffVsDefault(
  path: string,
  filePath: string,
  oldPath: string | null = null,
  scope?: ChangesScope,
): Promise<FileDiffVsDefault> {
  const raw: RawFileDiffVsDefault = await invoke("get_file_diff_vs_default", {
    path,
    filePath,
    oldPath,
    ...scopeArgs(scope),
  });
  return fileDiffVsDefaultFromRaw(raw);
}

// W5-T2 — 여러 저장소 원격 작업 확인 창(D3)
import type { RemoteOp, RepoRemotePlan } from "@/types";

/** 저장소마다 `op`을 실행하면 무엇이 일어날지. 결과는 `paths` 순서 그대로다. */
export async function planRemoteOp(paths: string[], op: RemoteOp): Promise<RepoRemotePlan[]> {
  return invoke("plan_remote_op", { paths, op });
}

// W5-T3
import type { BranchBaseInfo } from "@/types";

/**
 * 브랜치마다 기반 브랜치(어디서 갈라졌는지)와 기반보다 앞선·뒤처진 커밋 수.
 * 기록이 없으면 가장 가까운 분기점으로 추정한 값이다. 비용 때문에 화면에 보이는 행만 넘긴다.
 */
export async function getBranchBases(repoPath: string, names: string[]): Promise<BranchBaseInfo[]> {
  return invoke("branch_bases", { repoPath, names });
}
