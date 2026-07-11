import { invoke } from "@tauri-apps/api/core";
import type {
  StatusEntry,
  FileStatus,
  DiffOutput,
  BinaryPreview,
  RepoInfo,
  BranchInfo,
  RepoSyncStatus,
  CommitInfo,
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
} from "@/types";

// Git operations — backend returns indexStatus/worktreeStatus separately,
// but the frontend StatusEntry expects a single `status` field.

interface RawStatusEntry {
  path: string;
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
    if (entry.staged && entry.indexStatus !== "unchanged") {
      entries.push({
        path: entry.path,
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

export async function discardChanges(repoPath: string, paths: string[]): Promise<void> {
  return invoke("discard_changes", { repoPath, paths });
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

export async function revertCommit(repoPath: string, oid: string): Promise<void> {
  return invoke("revert_commit", { repoPath, oid });
}

export async function cherryPickCommit(repoPath: string, oid: string): Promise<void> {
  return invoke("cherry_pick_commit", { repoPath, oid });
}

export async function gitFetch(repoPath: string, accountId: string): Promise<void> {
  return invoke("git_fetch", { repoPath, accountId });
}

export async function gitPush(
  repoPath: string,
  accountId: string,
  force = false,
): Promise<void> {
  return invoke("git_push", { repoPath, accountId, force });
}

export async function gitPull(
  repoPath: string,
  accountId: string,
  rebase = false,
): Promise<void> {
  return invoke("git_pull", { repoPath, accountId, rebase });
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

export async function getRepoSyncStatus(repoPaths: string[]): Promise<RepoSyncStatus[]> {
  return invoke("repo_sync_status", { repoPaths });
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
): Promise<string> {
  return invoke("merge_branch_into_current", { repoPath, branch, strategy });
}

export async function checkMergeConflicts(
  repoPath: string,
  branch: string,
): Promise<MergePreCheckResult> {
  return invoke("check_merge_conflicts", { repoPath, branch });
}

/** "merge" | "rebase" | null — the operation currently in progress, if any. */
export async function getMergeState(repoPath: string): Promise<string | null> {
  return invoke("get_merge_state", { repoPath });
}

export async function abortMergeOrRebase(repoPath: string): Promise<void> {
  return invoke("abort_merge_or_rebase", { repoPath });
}

export async function continueMergeOrRebase(repoPath: string): Promise<void> {
  return invoke("continue_merge_or_rebase", { repoPath });
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
export async function stashPush(repoPath: string, message?: string): Promise<void> {
  return invoke("stash_push", { repoPath, message });
}

export async function stashPop(repoPath: string): Promise<void> {
  return invoke("stash_pop", { repoPath });
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

export async function stashPushPartial(repoPath: string, paths: string[], message?: string): Promise<void> {
  return invoke("stash_push_partial", { repoPath, paths, message });
}

// History — backend returns raw fields (oid, parentCount, etc.)
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

export async function getCommitHistory(
  repoPath: string,
  limit = 50,
  offset = 0,
): Promise<CommitInfo[]> {
  const raw: RawCommitHistory[] = await invoke("get_commit_history", { repoPath, limit, offset });
  return raw.map((c) => ({
    id: c.oid,
    shortId: c.oid.slice(0, 7),
    message: c.message,
    summary: c.summary,
    author: c.author,
    committer: c.author,
    timestamp: c.timestamp,
    parentIds: [],
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

export async function startGhLogin(): Promise<void> {
  return invoke("start_gh_login");
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
  canPush: boolean;
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

// Preview
export async function startWorktreePreview(repoPath: string, branch: string): Promise<void> {
  return invoke("start_worktree_preview", { repoPath, branch });
}

export async function stopWorktreePreview(repoPath: string): Promise<void> {
  return invoke("stop_worktree_preview", { repoPath });
}

export async function checkPreviewActive(repoPath: string): Promise<boolean> {
  return invoke("check_preview_active", { repoPath });
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

export async function startRepoWatch(repoPath: string): Promise<void> {
  return invoke("start_repo_watch", { repoPath });
}

export async function stopRepoWatch(): Promise<void> {
  return invoke("stop_repo_watch");
}
