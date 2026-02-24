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

export interface CommitInfo {
  id: string;
  shortId: string;
  message: string;
  summary: string;
  author: AuthorInfo;
  committer: AuthorInfo;
  timestamp: number;
  parentIds: string[];
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
  upstream: string | null;
  aheadBehind: { ahead: number; behind: number } | null;
}

export interface RepoInfo {
  path: string;
  name: string;
  currentBranch: string | null;
  isDirty: boolean;
  remotes: RemoteInfo[];
  accountId: string | null;
}

export interface RemoteInfo {
  name: string;
  url: string;
}

export interface AppSettings {
  theme: Theme;
  defaultEditor: string;
  defaultShell: string;
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
