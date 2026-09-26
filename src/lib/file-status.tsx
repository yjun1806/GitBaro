import type { FileStatus } from "@/types";

export const statusTextColors: Record<FileStatus, string> = {
  modified: "text-warning",
  added: "text-success",
  deleted: "text-danger",
  renamed: "text-info",
  copied: "text-info",
  untracked: "text-success",
  conflicted: "text-danger",
  ignored: "text-muted-foreground",
};

export const statusTooltips: Record<FileStatus, string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
  untracked: "Untracked",
  ignored: "Ignored",
  conflicted: "Conflicted",
};
