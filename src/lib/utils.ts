import { clsx } from "clsx";
import i18n from "@/i18n/config";
import type { AppError } from "@/types";

export function cn(...classes: (string | undefined | false | null)[]): string {
  return clsx(classes);
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp * 1000;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) return i18n.t("time.justNow");
  if (diffMinutes < 60) return i18n.t("time.minutesAgo", { count: diffMinutes });
  if (diffHours < 24) return i18n.t("time.hoursAgo", { count: diffHours });
  if (diffDays < 7) return i18n.t("time.daysAgo", { count: diffDays });
  if (diffDays < 30) return i18n.t("time.weeksAgo", { count: diffWeeks });
  if (diffMonths < 12) return i18n.t("time.monthsAgo", { count: diffMonths });
  return i18n.t("time.yearsAgo", { count: diffYears });
}

export function truncateHash(hash: string, length = 7): string {
  return hash.slice(0, length);
}

// Repo names may contain dots (vercel/next.js, user.github.io); only a trailing
// ".git" is stripped. SSH host aliases cannot be resolved here (no ssh config).
const GITHUB_REMOTE_PATTERNS = [
  // https://github.com/o/r, http://, https://user@github.com/o/r, ssh://git@github.com[:22]/o/r
  /^(?:https?|ssh|git|git\+ssh):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  // git@github.com:o/r
  /^(?:[^@/]+@)?github\.com:\/?([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
];

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  for (const pattern of GITHUB_REMOTE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }
  return null;
}

/** Git 리모트 URL(HTTPS/SSH)에서 GitHub 웹 URL을 추출. GitHub이 아니면 null. */
export function getGitHubWebUrl(remoteUrl: string): string | null {
  const parsed = parseGitHubUrl(remoteUrl);
  if (!parsed) return null;
  return `https://github.com/${parsed.owner}/${parsed.repo}`;
}

/** 원격 목록 중 처음 나오는 GitHub 원격의 웹 주소. 없으면 null. `origin`을 먼저 본다. */
export function gitHubRepoUrl(remotes: readonly { name: string; url: string }[]): string | null {
  const ordered = [...remotes].sort((a, b) => Number(b.name === "origin") - Number(a.name === "origin"));
  for (const remote of ordered) {
    const url = getGitHubWebUrl(remote.url);
    if (url) return url;
  }
  return null;
}

/** GitHub에서 커밋 하나를 여는 주소. */
export function gitHubCommitUrl(repoUrl: string, sha: string): string {
  return `${repoUrl}/commit/${sha}`;
}

/**
 * GitHub에서 브랜치를 여는 주소. 원격 브랜치(`origin/feat/x`)는 원격 이름을 뗀다.
 * 브랜치 이름의 `/`는 그대로 두고 나머지 글자만 URL용으로 바꾼다.
 */
export function gitHubBranchUrl(repoUrl: string, branch: string, isRemote = false): string {
  const name = isRemote && branch.includes("/") ? branch.slice(branch.indexOf("/") + 1) : branch;
  return `${repoUrl}/tree/${name.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * 바뀐 파일 수. 일부만 스테이지한 파일은 스테이지된 줄과 안 된 줄로 두 번 나오므로 경로로 센다.
 */
export function countChangedFiles(entries: readonly { path: string }[]): number {
  return new Set(entries.map((e) => e.path)).size;
}

/**
 * 원격 브랜치(`upstream/feat/x`)를 GitHub에서 여는 주소. 그 원격의 주소를 쓴다(origin이 아닐 수 있다).
 * 원격 이름이 `/`를 품을 수 있으므로 가장 긴 원격 이름부터 맞춘다. GitHub 원격이 아니거나 맞는
 * 원격이 없으면 null.
 */
export function gitHubRemoteBranchUrl(
  remotes: readonly { name: string; url: string }[],
  remoteRef: string,
): string | null {
  const remote = remotes
    .filter((r) => remoteRef.startsWith(`${r.name}/`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  const repoUrl = remote ? getGitHubWebUrl(remote.url) : null;
  if (!remote || !repoUrl) return null;
  return gitHubBranchUrl(repoUrl, remoteRef.slice(remote.name.length + 1));
}

/** 저장소 경로와 저장소 안 상대 경로를 잇는다. */
export function joinRepoPath(repoPath: string, relativePath: string): string {
  return `${repoPath.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
}

export function getFileExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "";
  return path.slice(lastDot + 1);
}

export function getFileName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? path;
}

/**
 * Whether two folder paths name the same folder, ignoring trailing slashes.
 * Used to tell when adding a folder found a repository above it.
 */
export function isSameFolder(a: string, b: string): boolean {
  const trim = (p: string) => p.replace(/\/+$/, "") || "/";
  return trim(a) === trim(b);
}

/** Whether `error` is a backend `AppError` of the given `type`. */
export function isAppErrorType(error: unknown, type: AppError["type"]): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type: unknown }).type === type
  );
}

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: string }).message);
  }
  return String(error);
}

/**
 * merge·rebase·pull이 충돌로 멈췄는지. 백엔드가 `{ type: "MergeConflict" }`로 보낸다.
 * 오류 문구에 "conflict"가 있는지로 판단하지 않는다(문구는 git 버전·언어마다 다르다).
 */
export function isMergeConflictError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type: unknown }).type === "MergeConflict"
  );
}
