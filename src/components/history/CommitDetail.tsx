import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GitCommit, Clock, Copy, Check, ChevronDown, Undo2 } from "lucide-react";
import { cn, formatDate, getErrorMessage } from "@/lib/utils";
import { FileStatusBadge } from "@/lib/file-status";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { useCommitReviewMutations, useCommitReviewStates } from "@/api/queries";
import type { CommitInfo, DiffOutput, FileStatus } from "@/types";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { CommitVerification } from "@/components/verify/CommitVerification";

function AuthorAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const [imgError, setImgError] = useState(false);
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((n) => n.charAt(0).toUpperCase())
    .join("");

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="w-5 h-5 rounded-full shrink-0"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium text-muted-foreground shrink-0">
      {initials}
    </div>
  );
}

interface CommitDetailProps {
  commit: CommitInfo;
  authorAvatarUrl?: string;
  changedFiles?: Array<{ path: string; status: FileStatus }>;
  selectedFileDiff?: DiffOutput | null;
  onSelectFile?: (path: string) => void;
}

export function CommitDetail({
  commit,
  authorAvatarUrl,
  changedFiles = [],
  selectedFileDiff,
  onSelectFile,
}: CommitDetailProps) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const addToast = useToastStore((s) => s.addToast);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [fileListWidth, setFileListWidth] = useState(320);

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(320);

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = fileListWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = ev.clientX - dragStartX.current;
        const next = Math.min(480, Math.max(140, dragStartWidth.current + delta));
        setFileListWidth(next);
      };

      const onMouseUp = () => {
        isDragging.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [fileListWidth],
  );

  // Auto-select first file when commit changes
  useEffect(() => {
    if (changedFiles.length > 0) {
      const first = changedFiles[0].path;
      setSelectedPath(first);
      onSelectFile?.(first);
    } else {
      setSelectedPath(null);
    }
  }, [commit.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileClick = (path: string) => {
    setSelectedPath(path);
    onSelectFile?.(path);
  };

  const selectedFileIdx = changedFiles.findIndex((f) => f.path === selectedPath);

  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: changedFiles,
    onSelect: (f) => handleFileClick(f.path),
    selectedIndex: selectedFileIdx,
  });

  const handleCopyHash = async () => {
    await navigator.clipboard.writeText(commit.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const hasBody = commit.message !== commit.summary;

  // V29 — marking "reviewed" lives here, next to the thing that was read,
  // instead of in a list where it could be ticked without opening anything.
  const reviewIds = useMemo(() => [commit.id], [commit.id]);
  const { data: reviewStates = [] } = useCommitReviewStates(activeRepoPath, reviewIds);
  const { mark, unmark } = useCommitReviewMutations(activeRepoPath);
  const isReviewed = reviewStates[0]?.status === "reviewed";
  const isReviewPending = mark.isPending || unmark.isPending;

  const handleToggleReviewed = async () => {
    try {
      if (isReviewed) await unmark.mutateAsync(commit.id);
      else await mark.mutateAsync(commit.id);
    } catch (err) {
      addToast(t("verify.review.markFailed", { error: getErrorMessage(err) }), "error");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact commit header */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        {hasBody ? (
          <button
            onClick={() => setBodyExpanded((v) => !v)}
            className="flex items-start gap-1 text-left w-full group"
          >
            <ChevronDown className={cn(
              "w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-all",
              !bodyExpanded && "-rotate-90",
            )} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground leading-snug">
                {commit.summary}
              </p>
              {bodyExpanded && (
                <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {commit.message.slice(commit.summary.length).trim()}
                </p>
              )}
            </div>
          </button>
        ) : (
          <p className="text-sm font-semibold text-foreground leading-snug">
            {commit.summary}
          </p>
        )}
        <div className="flex items-center gap-2.5 mt-2.5">
          {/* Author avatar + info */}
          <AuthorAvatar name={commit.author.name} avatarUrl={authorAvatarUrl} />
          <span className="text-xs font-medium text-foreground/80">{commit.author.name}</span>
          <span className="text-xs text-muted-foreground/60">{commit.author.email}</span>
          <span className="text-xs text-muted-foreground/40">·</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {formatDate(commit.timestamp)}
          </span>
          <span className="text-xs text-muted-foreground/40">·</span>
          <button
            onClick={handleCopyHash}
            className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            <GitCommit className="w-3 h-3" />
            {commit.shortId}
            {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
          </button>
          {commit.parentIds.length > 0 && (
            <>
              <span className="text-xs text-muted-foreground/40">·</span>
              <span className="text-xs font-mono text-muted-foreground">
                {commit.parentIds.map((id) => id.slice(0, 7)).join(", ")}
              </span>
            </>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => void handleToggleReviewed()}
            disabled={isReviewPending || activeRepoPath === null}
            title={isReviewed ? t("verify.review.unmarkReviewed") : t("verify.review.markReviewed")}
            className={cn(
              "shrink-0 flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-40",
              isReviewed
                ? "border-border bg-muted text-muted-foreground hover:bg-accent"
                : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
            )}
          >
            {isReviewed && <Undo2 className="w-3 h-3 shrink-0" />}
            {isReviewed ? t("verify.review.reviewed") : t("verify.review.markReviewed")}
          </button>
        </div>
      </div>

      {/* V31·V32·V35 plus the static diff rules — one line under the subject,
          because "is this worth reading" is the question asked before the diff. */}
      <CommitVerification
        repoPath={activeRepoPath}
        oid={commit.id}
        onNavigate={handleFileClick}
        className="shrink-0 border-b border-border"
      />

      {/* File list + Diff viewer */}
      <div className="flex h-0 flex-1">
        {/* File list */}
        <div
          style={{ width: fileListWidth }}
          className="shrink-0 border-r border-border flex flex-col"
        >
          <div className="px-3 h-[36px] border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("history.changedFiles")}
            </span>
            <span className="text-xs text-muted-foreground/60 tabular-nums">
              {changedFiles.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto" {...containerProps}>
            {changedFiles.map((f, index) => {
              const isSelected = selectedPath === f.path;
              const isHighlighted = activeIndex === index;
              const lastSlash = f.path.lastIndexOf("/");
              const dir = lastSlash >= 0 ? f.path.substring(0, lastSlash) : "";
              const filename = lastSlash >= 0
                ? f.path.substring(lastSlash + 1)
                : f.path;
              return (
                <button
                  key={f.path}
                  ref={itemRef(index)}
                  title={f.path}
                  onClick={() => handleFileClick(f.path)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
                    isSelected
                      ? "bg-primary/10"
                      : !isSelected && isHighlighted
                        ? "bg-accent ring-1 ring-primary/30"
                        : "hover:bg-accent",
                  )}
                >
                  <FileStatusBadge status={f.status} />
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className={cn(
                      "text-xs font-medium truncate",
                      isSelected ? "text-primary" : "text-foreground",
                    )}>
                      {filename}
                    </span>
                    {dir && (
                      <span className="text-[10px] leading-tight text-muted-foreground/50 truncate">
                        {dir}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={onResizeMouseDown}
          className="w-px shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors"
        />

        {/* Diff viewer */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <DiffViewer
            diff={selectedFileDiff ?? null}
            status={
              changedFiles.find((f) => f.path === selectedPath)?.status ?? "modified"
            }
            structural={
              activeRepoPath
                ? { repoPath: activeRepoPath, oid: commit.id, staged: false }
                : null
            }
          />
        </div>
      </div>
    </div>
  );
}
