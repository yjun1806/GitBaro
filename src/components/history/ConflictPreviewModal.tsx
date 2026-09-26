import { useState, useEffect, useCallback, useMemo } from "react";
import { AlertCircle, GitBranch, ArrowLeftRight, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getConflictFileDiff } from "@/api/commands";
import type { DiffOutput, DiffHunk } from "@/types";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { Notice } from "@/components/ui/Notice";
import { EmptyState } from "@/components/ui/EmptyState";
import { Count } from "@/components/ui/marks";

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
  both_modified: "text-warning border-warning/30 bg-warning/10",
  ours_only: "text-diff-del-fg border-diff-del-fg/30 bg-diff-del",
  theirs_only: "text-diff-add-fg border-diff-add-fg/30 bg-diff-add",
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
                    isDelete && "bg-diff-del",
                    isAdd && "bg-diff-add",
                  )}
                >
                  {/* Old line number */}
                  <span className="w-12 shrink-0 text-right pr-1 text-muted-foreground select-none text-[10px] border-r border-border/30">
                    {line.oldLineNo ?? ""}
                  </span>
                  {/* New line number */}
                  <span className="w-12 shrink-0 text-right pr-1 text-muted-foreground select-none text-[10px] border-r border-border/30">
                    {line.newLineNo ?? ""}
                  </span>
                  {/* Prefix */}
                  <span
                    className={cn(
                      "w-5 shrink-0 text-center select-none font-bold",
                      isDelete && "text-diff-del-fg",
                      isAdd && "text-diff-add-fg",
                      !isDelete && !isAdd && "text-muted-foreground",
                    )}
                  >
                    {prefix}
                  </span>
                  {/* Side label for changed lines */}
                  {isDelete && (
                    <span className="w-14 shrink-0 text-[9px] font-semibold text-diff-del-fg/70 flex items-center justify-center select-none">
                      {currentBranch.length > 8 ? "HEAD" : currentBranch}
                    </span>
                  )}
                  {isAdd && (
                    <span className="w-14 shrink-0 text-[9px] font-semibold text-diff-add-fg/70 flex items-center justify-center select-none">
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
    <DialogFrame title={t("merge.preCheck.previewTitle")} onClose={onClose} size="xl">
      <div className="h-full -m-4 flex flex-col overflow-hidden">
        {/* Branch context + legend bar */}
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-(--line) shrink-0">
          {/* Branches */}
          <div className="flex items-center gap-2 text-[11.5px]">
            <Count
              value={conflictFiles.length}
              tone="muted"
              label={t("merge.preCheck.previewFiles", { count: conflictFiles.length })}
            />
            <div className="flex items-center gap-1 text-diff-del-fg">
              <GitBranch className="w-3 h-3" />
              <span className="font-semibold">{currentBranch}</span>
            </div>
            <ArrowLeftRight className="w-3 h-3 text-muted-foreground" />
            <div className="flex items-center gap-1 text-diff-add-fg">
              <GitBranch className="w-3 h-3" />
              <span className="font-semibold">{branch}</span>
            </div>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2.5 rounded-sm bg-diff-del border border-diff-del-fg/40" />
              {t("merge.preCheck.previewOurs")}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2.5 rounded-sm bg-diff-add border border-diff-add-fg/40" />
              {t("merge.preCheck.previewTheirs", { branch })}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left — file list */}
          <div className="w-52 shrink-0 border-r border-(--line) overflow-y-auto">
            {conflictFiles.map((f) => (
              <button
                key={f}
                onClick={() => setSelectedFile(f)}
                className={cn(
                  "w-full text-left px-3 h-7 flex items-baseline gap-1.5 text-[12.5px] transition-colors border-b border-border/50",
                  selectedFile === f
                    ? "bg-(--acc-sel)"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="min-w-0 truncate font-medium text-foreground">{fileName(f)}</span>
                {dirName(f) && <span className="shrink-0 truncate text-[11.5px] text-muted-foreground">{dirName(f)}</span>}
              </button>
            ))}
          </div>

          {/* Right — inline annotated diff */}
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Stats bar */}
            {diff && diff.hunks.length > 0 && !isLoading && (
              <div className="flex items-center gap-3 px-3 py-1 border-b border-(--line) text-[11.5px] text-muted-foreground shrink-0">
                <span className="font-semibold text-foreground">
                  {t("merge.preCheck.previewRegions", {
                    count: stats.regions,
                  })}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-diff-del-fg/60" />
                  −{stats.removed}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-diff-add-fg/60" />
                  +{stats.added}
                </span>
              </div>
            )}

            {isLoading && (
              <LoadingState label={t("merge.preCheck.previewLoading")} />
            )}
            {error && !isLoading && (
              <div className="flex-1 flex items-center justify-center p-4">
                <Notice tone="danger" icon={AlertCircle}>{error}</Notice>
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
            {!isLoading && !error && (!diff || diff.hunks.length === 0) && (
              <EmptyState title={t("merge.preCheck.previewSelectFile")} />
            )}
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}
