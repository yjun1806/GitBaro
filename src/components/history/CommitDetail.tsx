import { useState, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Copy, Check, ChevronDown, Ban, CircleCheck, CircleDashed, XCircle } from "lucide-react";
import { cn, formatDate, formatRelativeTime } from "@/lib/utils";
import { Code, FileStatusLetter } from "@/components/ui/marks";
import { SectionLabel } from "@/components/ui/PanelHeader";
import { Spinner } from "@/components/ui/Spinner";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useRepositoryStore, findOwnerRepo } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useUIStore } from "@/stores/ui";
import { pickRepoAccountId } from "@/hooks/useRepoAccountId";
import {
  useCachedCommitIsUnpushed,
  useCachedHeadUpstream,
  useCachedRepoSyncStatus,
  useCachedWorkflowRunsState,
  useWorkflowRuns,
} from "@/api/queries";
import type { CommitInfo, DiffOutput, FileStatus, RepoSyncStatus, WorkflowRun } from "@/types";
import { ListDiffSplit } from "@/components/layout/ListDiffSplit";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { RepoWorkSwitcher } from "@/components/commit/WorkSwitcher";
import { useFileMenu } from "@/components/commit/useFileMenu";
import { contextMenuPoint } from "@/components/ui/ContextMenu";

const AVATAR_SIZE_CLASS = { 16: "w-4 h-4", 20: "w-5 h-5" } as const;

function AuthorAvatar({
  name,
  avatarUrl,
  size = 20,
}: {
  name: string;
  avatarUrl?: string;
  /** 20px(펼친 정보 줄) 또는 16px(접힌 요약 줄). */
  size?: 16 | 20;
}) {
  const [imgError, setImgError] = useState(false);
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((n) => n.charAt(0).toUpperCase())
    .join("");
  const sizeClass = AVATAR_SIZE_CLASS[size];

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={cn(sizeClass, "rounded-full shrink-0")}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        sizeClass,
        "rounded-full bg-muted flex items-center justify-center text-[9px] font-medium text-muted-foreground shrink-0",
      )}
    >
      {initials}
    </div>
  );
}

/**
 * Where a commit stands against its remote, for the "Remote" line. `remote`
 * is null when the remote cannot be named for sure.
 */
export type RemoteLine =
  | { kind: "pushed"; remote: string | null }
  | { kind: "unpushed"; remote: string | null; ahead: number }
  | { kind: "noUpstream" };

/**
 * Remote the branch is compared against. Taken from the upstream ref
 * ("upstream/feat" -> "upstream", longest matching remote name wins). Without
 * an upstream it is named only when the repository has a single remote.
 */
export function upstreamRemoteOf(
  upstream: string | null | undefined,
  remoteNames: string[],
): string | null {
  if (upstream) {
    const match = remoteNames
      .filter((name) => upstream.startsWith(`${name}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (match) return match;
  }
  return remoteNames.length === 1 ? remoteNames[0] : null;
}

/**
 * Remote line for one commit. `isUnpushed` comes from the history list (the
 * detail response does not carry it); undefined means the commit is not in
 * the loaded history, so the line is left out rather than guessed.
 */
export function remoteLineOf(
  isUnpushed: boolean | undefined,
  sync: RepoSyncStatus | undefined,
  remoteNames: string[],
  upstream?: string | null,
): RemoteLine | null {
  if (remoteNames.length === 0 || isUnpushed === undefined) return null;
  const remote = upstreamRemoteOf(upstream, remoteNames);
  if (!isUnpushed) return { kind: "pushed", remote };
  if (!sync) return null;
  if (!sync.hasUpstream) return { kind: "noUpstream" };
  return { kind: "unpushed", remote, ahead: sync.unpushed };
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

/** CI 상태별 아이콘(`running`은 `Spinner`를 쓰므로 뺀다). */
const CI_ICON: Record<Exclude<CiState, "running">, typeof CircleCheck> = {
  passed: CircleCheck,
  failed: XCircle,
  cancelled: Ban,
  other: CircleDashed,
};

/**
 * 접힌 요약 줄의 CI 아이콘 하나(글자 없음, 3.2 `StatusChip`과 달리 자리를 아낀다). 실행 기록이
 * 있을 때만 그린다(호출하는 쪽이 `showCi && ci`로 감싼다) — 뜻은 펼친 정보 칸의 CI 줄(이름 포함)과
 * 같고 표현만 다르다.
 */
function CiStateIcon({ ci }: { ci: CiSummary }) {
  const { t } = useTranslation();
  const label = t(`commitDetail2.ciState.${ci.state}`);
  const title = `${label} · ${ci.names.join(", ")}`;
  if (ci.state === "running") {
    return (
      <span title={title} className="inline-flex items-center shrink-0">
        <Spinner size="sm" className="text-warning" label={label} />
      </span>
    );
  }
  const Icon = CI_ICON[ci.state];
  return (
    <span role="img" aria-label={label} title={title} className="inline-flex items-center shrink-0">
      <Icon className={cn("w-3 h-3", CI_TONE[ci.state])} aria-hidden="true" />
    </span>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[56px_1fr] gap-x-1 text-[11.5px] leading-[18px]">
      <dt className="text-muted-foreground">{label}</dt>
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
  /**
   * 목록 맨 위의 [작업 중인 변경 | 커밋] 전환. 빼면 지금 연 저장소의 전환(`RepoWorkSwitcher`)을 둔다.
   * 다른 저장소의 커밋(워크스페이스 화면)은 그 화면이 자기 전환을 넘긴다.
   */
  switcher?: ReactNode;
}

export function CommitDetail({
  commit,
  repoPath: repoPathProp,
  authorAvatarUrl,
  changedFiles = [],
  selectedFileDiff,
  onSelectFile,
  switcher,
}: CommitDetailProps) {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 접힘·펼침은 전역으로 기억한다(모든 커밋·화면에서 같은 선택).
  const infoExpanded = useUIStore((s) => s.commitInfoExpanded);
  const setInfoExpanded = useUIStore((s) => s.setCommitInfoExpanded);

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

  // Read the history, sync status and branch list straight from the cache
  // that other screens fill. This view remounts on every commit click, so a
  // query observer here would re-fetch all of them on each click.
  const isUnpushed = useCachedCommitIsUnpushed(repoPath, commit.id);
  const sync = useCachedRepoSyncStatus(repoPath);
  const upstream = useCachedHeadUpstream(repoPath);
  const remoteLine = remoteLineOf(isUnpushed, sync, remoteNames, upstream);

  // Workflow runs: read the graph panel's cached list. Subscribe (and poll)
  // only while the list is missing or this commit's CI is still running.
  const ciEnabled = hasRemote && accountId !== null;
  const runsState = useCachedWorkflowRunsState(ciEnabled ? repoPath : null, accountId);
  const runs = ciEnabled ? runsState?.data : undefined;
  const ci = runs ? summarizeCi(runs, commit.id) : null;
  const runsMissing = runs === undefined && runsState?.status !== "error";
  const needRuns = ciEnabled && (runsMissing || ci?.state === "running");
  useWorkflowRuns(needRuns ? repoPath : null, accountId, { polling: true });
  const showCi = ciEnabled && runs !== undefined;

  // Auto-select first file when commit changes. Keyed on commit.id only: changedFiles and
  // onSelectFile get new identities on unrelated re-renders, which would reset the user's pick.
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

  // 파일 우클릭: 그 파일을 고르고 파일 메뉴(편집기·Finder·경로 복사)를 연다.
  const fileMenu = useFileMenu();
  const openFileMenu = (path: string, e: React.MouseEvent) => {
    e.preventDefault();
    handleFileClick(path);
    if (!repoPath) return;
    const status = changedFiles.find((f) => f.path === path)?.status;
    fileMenu.open({ repoPath, filePath: path, exists: status !== "deleted" }, contextMenuPoint(e));
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
  const pushPending = remoteLine !== null && remoteLine.kind !== "pushed";
  const toggleInfo = () => setInfoExpanded(!infoExpanded);

  const remoteText = (line: RemoteLine): string => {
    switch (line.kind) {
      case "pushed":
        return line.remote
          ? t("commitDetail2.remotePushed", { remote: line.remote })
          : t("commitDetail2.remotePushedUnnamed");
      case "unpushed":
        return line.remote
          ? t("commitDetail2.remoteUnpushed", { remote: line.remote, count: line.ahead })
          : t("commitDetail2.remoteUnpushedUnnamed", { count: line.ahead });
      case "noUpstream":
        return t("commitDetail2.remoteNoUpstream");
    }
  };

  const commitInfo = (
    <div className="border-b border-(--line) shrink-0">
      {/* 접힌 요약 줄(기본)과 펼치기 토글을 겸한다. sha 복사 버튼만 따로 클릭을 받는다(전파를 끊는다) —
          그 밖의 자리(요약 글, 메타 줄)를 누르면 이 줄 전체가 펼침·접힘을 바꾼다. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={infoExpanded}
        aria-label={infoExpanded ? t("commitDetail2.collapse") : t("commitDetail2.expand")}
        onClick={toggleInfo}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleInfo();
          }
        }}
        className="w-full flex items-start gap-1.5 px-3 py-2 text-left cursor-pointer hover:bg-accent transition-colors motion-reduce:transition-none"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "w-2.5 h-2.5 shrink-0 mt-1 text-muted-foreground transition-transform motion-reduce:transition-none",
            !infoExpanded && "-rotate-90",
          )}
          strokeWidth={2.6}
        />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <p
            className={cn(
              "text-[13px] font-semibold text-foreground leading-[18px]",
              !infoExpanded && "line-clamp-2",
            )}
          >
            {commit.summary}
          </p>
          {!infoExpanded && (
            <div className="flex items-center gap-1.5 min-w-0 text-[11.5px] text-muted-foreground">
              <AuthorAvatar name={commit.author.name} avatarUrl={authorAvatarUrl} size={16} />
              <span className="truncate font-medium text-(--fg2)" title={commit.author.email}>
                {commit.author.name}
              </span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0" title={formatDate(commit.timestamp)}>
                {formatRelativeTime(commit.timestamp)}
              </span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyHash();
                }}
                title={t("commitDetail2.copyHash")}
                className="inline-flex items-center gap-0.5 shrink-0 hover:text-foreground transition-colors"
              >
                <Code>{commit.shortId}</Code>
                {copied && <Check className="w-2.5 h-2.5 text-success" aria-hidden="true" />}
              </button>
              {showCi && ci && <CiStateIcon ci={ci} />}
              {pushPending && <span className="shrink-0">{t("commitDetail2.pushPending")}</span>}
            </div>
          )}
        </div>
      </div>
      {infoExpanded && (
        <div className="px-3 pb-3 flex flex-col gap-1.5">
          {hasBody && (
            <p className="text-[11.5px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {commit.message.slice(commit.summary.length).trim()}
            </p>
          )}
          <div className="flex items-center gap-1.5 min-w-0 text-[11.5px] text-muted-foreground">
            <AuthorAvatar name={commit.author.name} avatarUrl={authorAvatarUrl} />
            <span className="truncate font-medium text-(--fg2)" title={commit.author.email}>
              {commit.author.name}
            </span>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1 shrink-0" title={formatDate(commit.timestamp)}>
              <Clock className="w-3 h-3" />
              {formatRelativeTime(commit.timestamp)}
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
                  <span className="ml-1.5 text-muted-foreground">{t("commitDetail2.agentGuess")}</span>
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
                  <span className="text-muted-foreground">
                    {/* The list holds only the newest runs of the whole repository,
                        so a miss means "not among them", not "never ran". */}
                    {runs && runs.length > 0
                      ? t("commitDetail2.ciNotRecent", { count: runs.length })
                      : t("commitDetail2.ciNone")}
                  </span>
                )}
              </MetaRow>
            )}
            {remoteLine && (
              <MetaRow label={t("commitDetail2.remote")}>{remoteText(remoteLine)}</MetaRow>
            )}
          </dl>
        </div>
      )}
    </div>
  );

  return (
    <ListDiffSplit
      variant="inline"
      className="animate-content-in"
      files={{
        items: changedFiles.map((f) => ({ key: f.path, path: f.path, status: f.status })),
        selectedKey: selectedPath,
        onSelect: handleFileClick,
        onContextMenu: openFileMenu,
      }}
      list={
        <>
          {switcher === undefined ? <RepoWorkSwitcher mode="commit" /> : switcher}
          {/* 정보 칸과 파일 목록이 한 스크롤 칸을 함께 쓴다. 「바뀐 파일 N」은 붙박이로 위에 남는다. */}
          <div className="flex-1 min-h-0 overflow-y-auto" data-testid="commit-detail-scroll" {...containerProps}>
            {commitInfo}
            <SectionLabel
              title={t("commitDetail2.changedFiles", { count: changedFiles.length })}
              className="sticky top-0 z-10 bg-card border-b border-(--line)"
            />
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
                  onContextMenu={(e) => openFileMenu(f.path, e)}
                  className={cn(
                    "w-full flex items-center gap-2 h-7 px-3 text-left transition-colors",
                    isSelected
                      ? "bg-(--acc-sel)"
                      : !isSelected && isHighlighted
                        ? "bg-accent ring-1 ring-inset ring-primary/30"
                        : "hover:bg-accent",
                  )}
                >
                  <FileStatusLetter status={f.status} />
                  <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
                    <span className="text-[12.5px] font-medium text-foreground truncate">{filename}</span>
                    {dir && <span className="text-[11.5px] text-muted-foreground truncate">{dir}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      }
      detail={
        <DiffViewer
          maximizable
          repoPath={repoPath}
          diff={selectedFileDiff ?? null}
          status={changedFiles.find((f) => f.path === selectedPath)?.status ?? "modified"}
        />
      }
    >
      {/* 메뉴는 목록 칸 밖에 둔다 — 크게 보는 동안 목록 칸은 숨겨져도 옆 목록에서 메뉴를 연다. */}
      {fileMenu.element}
    </ListDiffSplit>
  );
}
