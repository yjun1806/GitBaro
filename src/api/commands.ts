import { invoke } from "@tauri-apps/api/core";
import type {
  StatusEntry,
  FileStatus,
  DiffOutput,
  RepoInfo,
  BranchInfo,
  CommitInfo,
  GitHubAccount,
  GhStatus,
  AppSettings,
  Theme,
} from "@/types";

// Git operations — backend returns indexStatus/worktreeStatus separately,
// but the frontend StatusEntry expects a single `status` field.

interface RawStatusEntry {
  path: string;
  staged: boolean;
  unstaged: boolean;
  indexStatus: string;
  worktreeStatus: string;
}

export async function getStatus(repoPath: string): Promise<StatusEntry[]> {
  const raw: RawStatusEntry[] = await invoke("get_status", { repoPath });
  const entries: StatusEntry[] = [];

  for (const entry of raw) {
    if (entry.staged && entry.indexStatus !== "unchanged") {
      entries.push({
        path: entry.path,
        status: entry.indexStatus as FileStatus,
        staged: true,
      });
    }
    if (entry.unstaged && entry.worktreeStatus !== "unchanged") {
      entries.push({
        path: entry.path,
        status: entry.worktreeStatus as FileStatus,
        staged: false,
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

export async function getOpenRepos(): Promise<RepoInfo[]> {
  return invoke("get_open_repos");
}

export async function closeRepository(path: string): Promise<void> {
  return invoke("close_repository", { path });
}

export async function addLocalRepository(path: string): Promise<RepoInfo> {
  return invoke("add_local_repository", { path });
}

// Branches
export async function getBranches(repoPath: string): Promise<BranchInfo[]> {
  return invoke("get_branches", { repoPath });
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

export async function getCurrentBranch(repoPath: string): Promise<string | null> {
  return invoke("get_current_branch", { repoPath });
}

// History — backend returns raw fields (oid, parentCount, etc.)
// that differ from the frontend CommitInfo type, so we map here.

interface RawCommitHistory {
  oid: string;
  message: string;
  summary: string;
  author: { name: string; email: string };
  timestamp: number;
  parentCount: number;
}

interface RawCommitDetail {
  oid: string;
  message: string;
  summary: string;
  author: { name: string; email: string };
  committer: { name: string; email: string };
  timestamp: number;
  parents: string[];
  diff: unknown;
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

export async function getCommitDetail(
  repoPath: string,
  oid: string,
): Promise<CommitInfo> {
  const c: RawCommitDetail = await invoke("get_commit_detail", { repoPath, oid });
  return {
    id: c.oid,
    shortId: c.oid.slice(0, 7),
    message: c.message,
    summary: c.summary,
    author: c.author,
    committer: c.committer,
    timestamp: c.timestamp,
    parentIds: c.parents,
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
  insertions: number;
  deletions: number;
  hunks: RawDiffHunk[];
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
    oldContent: "",
    newContent: "",
    binary: false,
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
