import { useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  Loader2,
  AlertCircle,
  FileWarning,
  GitBranch,
  ArrowLeftRight,
  Minus,
  Plus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getConflictFileDiff } from "@/api/commands";
import type { DiffOutput, DiffHunk } from "@/types";

interface ConflictPreviewModalProps {
  repoPath: string;
  branch: string;
  currentBranch: string;
  conflictFiles: string[];
  onClose: () => void;
}

// --- Conflict analysis ---

type ConflictType = "both_modified" | "ours_only" | "theirs_only";

interface HunkAnalysis {
  type: ConflictType;
  oursLines: number;
  theirsLines: number;
  lineStart: number;
  lineEnd: number;
}

function classifyHunk(hunk: DiffHunk): HunkAnalysis {
  let oursLines = 0;
  let theirsLines = 0;
  for (const line of hunk.lines) {
    if (line.lineType === "delete") oursLines++;
    else if (line.lineType === "add") theirsLines++;
  }

  const type: ConflictType =
    oursLines > 0 && theirsLines > 0
      ? "both_modified"
      : oursLines > 0
        ? "ours_only"
        : "theirs_only";

  const lineEnd = hunk.oldStart + hunk.oldLines - 1;

  return {
    type,
    oursLines,
    theirsLines,
    lineStart: hunk.oldStart,
    lineEnd: lineEnd > hunk.oldStart ? lineEnd : hunk.oldStart,
  };
}

const CONFLICT_ICONS: Record<ConflictType, typeof ArrowLeftRight> = {
  both_modified: ArrowLeftRight,
  ours_only: Minus,
  theirs_only: Plus,
};

const CONFLICT_COLORS: Record<ConflictType, string> = {
  both_modified: "text-warning border-warning/30 bg-amber-50 dark:bg-amber-950",
  ours_only: "text-red-600 dark:text-red-400 border-red-500/30 bg-red-50 dark:bg-red-950",
  theirs_only: "text-green-600 dark:text-green-400 border-green-500/30 bg-green-50 dark:bg-green-950",
};

const CONFLICT_I18N: Record<ConflictType, string> = {
  both_modified: "merge.preCheck.previewConflictBothModified",
  ours_only: "merge.preCheck.previewConflictOursOnly",
  theirs_only: "merge.preCheck.previewConflictTheirsOnly",
};

// --- Inline diff renderer with hunk annotations ---

function InlineConflictDiff({
  diff,
  branch,
  currentBranch,
}: {
  diff: DiffOutput;
  branch: string;
  currentBranch: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="font-mono text-xs leading-5">
      {diff.hunks.map((hunk, hunkIdx) => {
        const analysis = classifyHunk(hunk);
        const Icon = CONFLICT_ICONS[analysis.type];

        return (
          <div key={hunkIdx}>
            {/* Conflict annotation banner — directly above the changed lines */}
            <div
              className={cn(
                "sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 border-y text-[11px]",
                CONFLICT_COLORS[analysis.type],
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="font-semibold">
                {t("merge.preCheck.previewLineRange", {
                  start: analysis.lineStart,
                  end: analysis.lineEnd,
                })}
              </span>
              <span className="opacity-60">—</span>
              <span>{t(CONFLICT_I18N[analysis.type])}</span>
              <span className="ml-auto text-[10px] opacity-70">
                −{analysis.oursLines} / +{analysis.theirsLines}
              </span>
            </div>

            {/* Diff lines for this hunk */}
            {hunk.lines.map((line, lineIdx) => {
              const isDelete = line.lineType === "delete";
              const isAdd = line.lineType === "add";
              const prefix = isAdd ? "+" : isDelete ? "−" : " ";

              return (
                <div
                  key={lineIdx}
                  className={cn(
                    "flex",
                    isDelete && "bg-red-500/10 dark:bg-red-400/8",
                    isAdd && "bg-green-500/10 dark:bg-green-400/8",
                  )}
                >
                  {/* Old line number */}
                  <span className="w-12 shrink-0 text-right pr-1 text-muted-foreground/50 select-none text-[10px] border-r border-border/30">
                    {line.oldLineNo ?? ""}
                  </span>
                  {/* New line number */}
                  <span className="w-12 shrink-0 text-right pr-1 text-muted-foreground/50 select-none text-[10px] border-r border-border/30">
                    {line.newLineNo ?? ""}
                  </span>
                  {/* Prefix */}
                  <span
                    className={cn(
                      "w-5 shrink-0 text-center select-none font-bold",
                      isDelete && "text-red-600 dark:text-red-400",
                      isAdd && "text-green-600 dark:text-green-400",
                      !isDelete && !isAdd && "text-muted-foreground/30",
                    )}
                  >
                    {prefix}
                  </span>
                  {/* Side label for changed lines */}
                  {isDelete && (
                    <span className="w-14 shrink-0 text-[9px] font-semibold text-red-600/70 dark:text-red-400/60 flex items-center justify-center select-none">
                      {currentBranch.length > 8 ? "HEAD" : currentBranch}
                    </span>
                  )}
                  {isAdd && (
                    <span className="w-14 shrink-0 text-[9px] font-semibold text-green-600/70 dark:text-green-400/60 flex items-center justify-center select-none">
                      {branch.length > 8 ? branch.slice(0, 8) + "…" : branch}
                    </span>
                  )}
                  {!isDelete && !isAdd && (
                    <span className="w-14 shrink-0" />
                  )}
                  {/* Content */}
                  <span className="px-1 whitespace-pre overflow-x-auto min-w-0">
                    {line.content.replace(/\n$/, "")}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// --- Main modal ---

export function ConflictPreviewModal({
  repoPath,
  branch,
  currentBranch,
  conflictFiles,
  onClose,
}: ConflictPreviewModalProps) {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<string>(
    conflictFiles[0] ?? "",
  );
  const [diff, setDiff] = useState<DiffOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiff = useCallback(
    async (filePath: string) => {
      setIsLoading(true);
      setError(null);
      setDiff(null);
      try {
        const result = await getConflictFileDiff(repoPath, branch, filePath);
        setDiff(result);
      } catch {
        setError(t("merge.preCheck.previewError"));
      } finally {
        setIsLoading(false);
      }
    },
    [repoPath, branch, t],
  );

  useEffect(() => {
    if (selectedFile) {
      loadDiff(selectedFile);
    }
  }, [selectedFile, loadDiff]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const stats = useMemo(() => {
    if (!diff) return { regions: 0, added: 0, removed: 0 };
    let added = 0;
    let removed = 0;
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.lineType === "add") added++;
        else if (line.lineType === "delete") removed++;
      }
    }
    return { regions: diff.hunks.length, added, removed };
  }, [diff]);

  const fileName = (path: string) => path.split("/").pop() ?? path;
  const dirName = (path: string) => {
    const parts = path.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl max-w-7xl w-full mx-4 h-[92vh] flex flex-col overflow-hidden border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <FileWarning className="w-4 h-4 text-warning" />
            <h2 className="text-sm font-semibold text-foreground">
              {t("merge.preCheck.previewTitle")}
            </h2>
            <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
              {t("merge.preCheck.previewFiles", {
                count: conflictFiles.length,
              })}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Branch context + legend bar */}
        <div className="flex items-center justify-between px-4 py-1.5 bg-muted/30 border-b border-border shrink-0">
          {/* Branches */}
          <div className="flex items-center gap-2 text-[11px]">
            <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <GitBranch className="w-3 h-3" />
              <span className="font-semibold">{currentBranch}</span>
            </div>
            <ArrowLeftRight className="w-3 h-3 text-muted-foreground" />
            <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <GitBranch className="w-3 h-3" />
              <span className="font-semibold">{branch}</span>
            </div>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2.5 rounded-sm bg-red-500/25 border border-red-500/40" />
              {t("merge.preCheck.previewOurs")}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2.5 rounded-sm bg-green-500/25 border border-green-500/40" />
              {t("merge.preCheck.previewTheirs", { branch })}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left — file list */}
          <div className="w-52 shrink-0 border-r border-border overflow-y-auto bg-surface">
            {conflictFiles.map((f) => (
              <button
                key={f}
                onClick={() => setSelectedFile(f)}
                className={cn(
                  "w-full text-left px-3 py-2 text-xs transition-colors border-b border-border/50",
                  selectedFile === f
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <span className="block font-medium truncate">
                  {fileName(f)}
                </span>
                <span className="block text-[10px] text-muted-foreground truncate">
                  {dirName(f)}
                </span>
              </button>
            ))}
          </div>

          {/* Right — inline annotated diff */}
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Stats bar */}
            {diff && diff.hunks.length > 0 && !isLoading && (
              <div className="flex items-center gap-3 px-3 py-1 bg-muted/40 border-b border-border text-[10px] text-muted-foreground shrink-0">
                <span className="font-semibold text-foreground">
                  {t("merge.preCheck.previewRegions", {
                    count: stats.regions,
                  })}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-red-500/60" />
                  −{stats.removed}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-green-500/60" />
                  +{stats.added}
                </span>
              </div>
            )}

            {isLoading && (
              <div className="flex items-center justify-center flex-1 gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">
                  {t("merge.preCheck.previewLoading")}
                </span>
              </div>
            )}
            {error && !isLoading && (
              <div className="flex items-center justify-center flex-1 gap-2 text-destructive">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">{error}</span>
              </div>
            )}
            {!isLoading && !error && diff && diff.hunks.length > 0 && (
              <div className="flex-1 min-h-0 overflow-auto">
                <InlineConflictDiff
                  diff={diff}
                  branch={branch}
                  currentBranch={currentBranch}
                />
              </div>
            )}
            {!isLoading && !error && diff && diff.hunks.length === 0 && (
              <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
                {t("merge.preCheck.previewSelectFile")}
              </div>
            )}
            {!isLoading && !error && !diff && (
              <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
                {t("merge.preCheck.previewSelectFile")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
