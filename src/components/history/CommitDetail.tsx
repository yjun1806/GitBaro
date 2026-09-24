import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Copy, Check, ChevronDown } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { FileStatusBadge } from "@/lib/file-status";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useRepositoryStore, findOwnerRepo } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { pickRepoAccountId } from "@/hooks/useRepoAccountId";
import { useCommitHistoryInfinite, useRepoSyncStatuses, useWorkflowRuns } from "@/api/queries";
import type { CommitInfo, DiffOutput, FileStatus, RepoSyncStatus, WorkflowRun } from "@/types";
import { DiffViewer } from "@/components/diff/DiffViewer";

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

/** Where a commit stands against its remote, for the "Remote" line. */
export type RemoteLine =
  | { kind: "pushed"; remote: string }
  | { kind: "unpushed"; remote: string; ahead: number }
  | { kind: "noUpstream" };

/**
 * Remote line for one commit. `isUnpushed` comes from the history list (the
 * detail response does not carry it); undefined means the commit is not in
 * the loaded history, so the line is left out rather than guessed.
 */
export function remoteLineOf(
  isUnpushed: boolean | undefined,
  sync: RepoSyncStatus | undefined,
  remoteNames: string[],
): RemoteLine | null {
  if (remoteNames.length === 0 || isUnpushed === undefined) return null;
  const remote = remoteNames.includes("origin") ? "origin" : remoteNames[0];
  if (!isUnpushed) return { kind: "pushed", remote };
  if (!sync) return null;
  if (!sync.hasUpstream) return { kind: "noUpstream" };
  return { kind: "unpushed", remote, ahead: sync.ahead };
}

export type CiState = "running" | "failed" | "passed" | "cancelled" | "other";

export interface CiSummary {
  state: CiState;
  /** Workflow names that ran on this commit, newest run of each. */
  names: string[];
}

const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure", "action_required"]);
const PASSED_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

/**
 * CI result for one commit, read from the existing workflow run list by
 * `headSha`. Only the newest run of each workflow counts, so a re-run that
 * passed hides the earlier failure. Returns null when no run matches.
 */
export function summarizeCi(runs: WorkflowRun[], sha: string): CiSummary | null {
  const latestByName = new Map<string, WorkflowRun>();
  const byNewest = runs
    .filter((r) => r.headSha === sha)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const run of byNewest) {
    if (!latestByName.has(run.name)) latestByName.set(run.name, run);
  }
  const latest = [...latestByName.values()];
  if (latest.length === 0) return null;

  const conclusions = latest.map((r) => (r.status === "completed" ? r.conclusion ?? "" : null));
  const state: CiState = conclusions.some((c) => c === null)
    ? "running"
    : conclusions.some((c) => FAILED_CONCLUSIONS.has(c ?? ""))
      ? "failed"
      : conclusions.every((c) => PASSED_CONCLUSIONS.has(c ?? ""))
        ? "passed"
        : conclusions.some((c) => c === "cancelled")
          ? "cancelled"
          : "other";
  return { state, names: latest.map((r) => r.name) };
}

const CI_TONE: Record<CiState, string> = {
  running: "text-warning",
  failed: "text-danger",
  passed: "text-success",
  cancelled: "text-muted-foreground",
  other: "text-muted-foreground",
};

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_1fr] gap-x-1 text-[11.5px] leading-[18px]">
      <dt className="text-(--faint)">{label}</dt>
      <dd className="min-w-0 text-(--fg2) break-words">{children}</dd>
    </div>
  );
}

function repoNameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || path;
}

interface CommitDetailProps {
  commit: CommitInfo;
  /** Repository the commit belongs to. Defaults to the active repository. */
  repoPath?: string;
  authorAvatarUrl?: string;
  changedFiles?: Array<{ path: string; status: FileStatus }>;
  selectedFileDiff?: DiffOutput | null;
  onSelectFile?: (path: string) => void;
}

export function CommitDetail({
  commit,
  repoPath: repoPathProp,
  authorAvatarUrl,
  changedFiles = [],
  selectedFileDiff,
  onSelectFile,
}: CommitDetailProps) {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [fileListWidth, setFileListWidth] = useState(320);

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(320);

  // Repository context: name, remotes and account for the meta lines.
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const repoPath = repoPathProp ?? activeRepoPath;
  const repos = useRepositoryStore((s) => s.repos);
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const activeWorktrees = useRepositoryStore((s) => s.activeWorktrees);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const ownerRepo = findOwnerRepo(repos, repoPath, activeWorktrees);
  const repoInfo =
    (activeRepo && activeRepo.path === repoPath ? activeRepo : null) ??
    repos.find((r) => r.path === repoPath) ??
    ownerRepo;
  const remoteNames = (repoInfo?.remotes ?? []).map((r) => r.name);
  const hasRemote = remoteNames.length > 0;
  const accountId = pickRepoAccountId(ownerRepo, activeAccountId);

  // Read-only lookups of data other screens already load.
  const { data: history } = useCommitHistoryInfinite(repoPath);
  const isUnpushed = history?.pages.flat().find((c) => c.id === commit.id)?.isUnpushed;
  const { data: syncByPath } = useRepoSyncStatuses(repoPath ? [repoPath] : []);
  const sync = repoPath ? syncByPath?.[repoPath] : undefined;
  const { data: runs, isSuccess: runsLoaded } = useWorkflowRuns(
    hasRemote ? repoPath : null,
    accountId,
  );

  const remoteLine = remoteLineOf(isUnpushed, sync, remoteNames);
  const ci = runsLoaded && runs ? summarizeCi(runs, commit.id) : null;
  const showCi = hasRemote && accountId !== null && runsLoaded;

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

  const remoteText = (line: RemoteLine): string => {
    switch (line.kind) {
      case "pushed":
        return t("commitDetail2.remotePushed", { remote: line.remote });
      case "unpushed":
        return t("commitDetail2.remoteUnpushed", { remote: line.remote, count: line.ahead });
      case "noUpstream":
        return t("commitDetail2.remoteNoUpstream");
    }
  };

  const commitInfo = (
    <div className="px-3 py-3 flex flex-col gap-1.5 border-b border-(--line) shrink-0 max-h-[55%] overflow-y-auto">
      {hasBody ? (
        <button
          type="button"
          onClick={() => setBodyExpanded((v) => !v)}
          className="flex items-start gap-1 text-left w-full group"
        >
          <ChevronDown className={cn(
            "w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-all",
            !bodyExpanded && "-rotate-90",
          )} />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-foreground leading-[18px]">{commit.summary}</p>
            {bodyExpanded && (
              <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {commit.message.slice(commit.summary.length).trim()}
              </p>
            )}
          </div>
        </button>
      ) : (
        <p className="text-[13px] font-bold text-foreground leading-[18px]">{commit.summary}</p>
      )}
      <div className="flex items-center gap-1.5 min-w-0 text-[11.5px] text-muted-foreground">
        <AuthorAvatar name={commit.author.name} avatarUrl={authorAvatarUrl} />
        <span className="truncate font-medium text-(--fg2)" title={commit.author.email}>
          {commit.author.name}
        </span>
        <span aria-hidden="true">·</span>
        <span className="flex items-center gap-1 shrink-0">
          <Clock className="w-3 h-3" />
          {formatDate(commit.timestamp)}
        </span>
      </div>
      <dl className="flex flex-col gap-0.5">
        {repoPath && (
          <MetaRow label={t("commitDetail2.repo")}>{repoInfo?.name ?? repoNameOf(repoPath)}</MetaRow>
        )}
        <MetaRow label={t("commitDetail2.commit")}>
          <button
            type="button"
            onClick={handleCopyHash}
            title={t("commitDetail2.copyHash")}
            className="inline-flex items-center gap-1 font-mono hover:text-foreground transition-colors"
          >
            {commit.shortId}
            {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
          </button>
          <span aria-hidden="true"> · </span>
          {commit.parentIds.length > 0 ? (
            <>
              {t("commitDetail2.parents", { count: commit.parentIds.length })}{" "}
              <span className="font-mono">
                {commit.parentIds.map((id) => id.slice(0, 7)).join(", ")}
              </span>
            </>
          ) : (
            t("commitDetail2.noParents")
          )}
        </MetaRow>
        {commit.coAuthors.length > 0 && (
          <MetaRow label={t("commitDetail2.coAuthors")}>
            <span data-testid="commit-co-authors">
              {commit.coAuthors.map((a, i) => (
                <span key={`${a.email}-${i}`} title={a.email}>
                  {i > 0 && ", "}
                  {a.name}
                </span>
              ))}
            </span>
            {commit.isAgentAuthored && (
              <span className="ml-1.5 text-(--faint)">{t("commitDetail2.agentGuess")}</span>
            )}
          </MetaRow>
        )}
        {showCi && (
          <MetaRow label={t("commitDetail2.ci")}>
            {ci ? (
              <span>
                <span className={cn("font-bold", CI_TONE[ci.state])}>
                  {t(`commitDetail2.ciState.${ci.state}`)}
                </span>
                {" · "}
                {ci.names.join(", ")}
              </span>
            ) : (
              <span className="text-(--faint)">{t("commitDetail2.ciNone")}</span>
            )}
          </MetaRow>
        )}
        {remoteLine && (
          <MetaRow label={t("commitDetail2.remote")}>{remoteText(remoteLine)}</MetaRow>
        )}
      </dl>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* File list + Diff viewer */}
      <div className="flex h-0 flex-1">
        {/* File list */}
        <div
          style={{ width: fileListWidth }}
          className="shrink-0 border-r border-border flex flex-col min-h-0"
        >
          {commitInfo}
          <div className="px-3 h-[36px] border-b border-border flex items-center justify-between shrink-0">
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
          />
        </div>
      </div>
    </div>
  );
}
