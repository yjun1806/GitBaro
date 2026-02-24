import { clsx } from "clsx";
import i18n from "@/i18n/config";

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
  if (diffWeeks < 4) return i18n.t("time.weeksAgo", { count: diffWeeks });
  if (diffMonths < 12) return i18n.t("time.monthsAgo", { count: diffMonths });
  return i18n.t("time.yearsAgo", { count: diffYears });
}

export function truncateHash(hash: string, length = 7): string {
  return hash.slice(0, length);
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const patterns = [
    /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }
  return null;
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

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: string }).message);
  }
  return String(error);
}
