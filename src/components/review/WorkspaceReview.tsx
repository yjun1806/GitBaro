import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, Files, Folder, GitCommitVertical } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useWorkspaceStore } from "@/stores/workspace";
import { repoAccountsByPath } from "@/lib/repo-tree";
import { baseName } from "./review-model";
import { Card, EmptyState } from "@/components/layout/ContentArea";
import { GraphSplit } from "@/components/layout/GraphSplit";
import { RepoLaneCommitGraph } from "@/components/graph/CommitGraph";
import { repoLaneColor } from "@/components/graph/repo-lanes";
import type { WorkspaceRepoHistory } from "@/types";
import { WorkspaceTitle } from "./WorkspaceTitle";
import { ReviewFilesPanel, type ReviewSelection } from "./ReviewFilesPanel";
import { useWorkspaceReview, type ReviewRepo } from "./useWorkspaceReview";
import { useReviewActivityRefresh } from "./useReviewActivityRefresh";
import { FilesByRepo } from "./FilesByRepo";
import { FilesGroupByPicker } from "./FilesGroupByPicker";
import { useFilesViewStore } from "./files-view";
import { badgeCount } from "./tab-counts";
import { useBranchChangesTab } from "./useChangedFileCount";
import { TabGroup, Tab } from "@/components/ui/Tabs";
import { cn } from "@/lib/utils";

export interface WorkspaceReviewProps {
  workspaceId: string;
  /** 워크스페이스에 지금 드는 저장소 경로(`useActiveScope`의 `paths`). */
  paths: string[];
}

/**
 * 워크스페이스를 고른 상태의 메인 칸(D1). 제목, 여러 저장소 커밋 그래프(저장소별 레인),
 * 아래에 고른 커밋이나 커밋하지 않은 변경의 파일 목록과 diff.
 * 「main 대비 변경」 탭(D7)을 고르면 그래프 대신 저장소별 main 대비 변경 목록과 연결된 변경을 보여 준다.
 * 조용한 저장소(main에 있고 새 커밋·커밋하지 않은 변경이 없음)는 접고 「모두 보기」로 펼친다.
 */
export function WorkspaceReview({ workspaceId, paths }: WorkspaceReviewProps) {
  const { t } = useTranslation();
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const repos = useRepositoryStore((s) => s.repos);
  const accounts = useAccountStore((s) => s.accounts);
  const [showAll, setShowAll] = useState(false);
  const [selection, setSelection] = useState<ReviewSelection>(null);
  const [tab, setTab] = useState<"graph" | "files">("graph");
  const groupBy = useFilesViewStore((s) => s.groupBy);
  const setGroupBy = useFilesViewStore((s) => s.setGroupBy);

  const data = useWorkspaceReview(paths, showAll);
  useReviewActivityRefresh(data.repoPaths);

  const accountLabel = useMemo(() => {
    const byPath = repoAccountsByPath(repos, accounts);
    const known = paths.map((p) => byPath.get(p)).find((a) => a && !a.pending);
    return known?.label ?? workspace?.accountKey ?? "";
  }, [repos, accounts, paths, workspace?.accountKey]);

  const nameByPath = useMemo(() => new Map(data.repos.map((r) => [r.path, r.name])), [data.repos]);
  const repoLabel = useCallback((path: string) => nameByPath.get(path) ?? path, [nameByPath]);

  const titleSlot = useToolbarTitleSlot();
  // 그래프 탭은 저장소마다 모든 워크트리의 WIP 행을 보여 준다(에이전트가 딴 워크트리에서 작업하기
  // 때문이다). 「main 대비 변경」도 같은 목록을 봐야 두 탭이 같은 이야기를 한다 — main만 보면 안 된다.
  const filesRepos = useMemo(
    () =>
      data.visible.flatMap((r) =>
        r.worktrees.map((w) => ({
          path: w.path,
          name: w.isMain ? r.name : `${r.name} · ${baseName(w.path)}`,
        })),
      ),
    [data.visible],
  );

  // 「main 대비 변경」 배지: 그 탭이 보여 줄 워크트리마다 main 대비 파일 수의 합.
  const fileCountEntries = useMemo(
    () => data.visible.flatMap((r) => r.worktrees.map((w) => ({ path: w.path, headOid: w.headOid }))),
    [data.visible],
  );
  const branchChanges = useBranchChangesTab(fileCountEntries);

  if (!workspace) return null;

  const title = (
    <WorkspaceTitle
      name={workspace.name}
      accountLabel={accountLabel}
      total={data.repos.length}
      shown={data.visible.length}
    />
  );
  const emptyMessage =
    data.visible.length === 0 && data.hiddenCount > 0
      ? t("review.allQuiet", { count: data.hiddenCount })
      : undefined;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-(--g)">
      {titleSlot ? createPortal(title, titleSlot) : title}
      {data.repos.length === 0 ? (
        <Card className="flex-1">
          <EmptyState icon={Folder} title={t("review.emptyTitle")} description={t("review.emptyHint")} />
        </Card>
      ) : (
        <GraphSplit
          topCollapsed={tab !== "graph"}
          top={
          <section
            aria-label={t("shell.panelTabs")}
            className={cn(
              "relative flex flex-col shrink-0 bg-card rounded-(--radius-panel) shadow-(--shadow) overflow-hidden",
              tab === "graph" && "flex-1 min-h-0",
            )}
          >
            <div className="flex items-center gap-2 min-h-8 pl-3 pr-3 shrink-0 border-b border-(--line)">
              <TabGroup aria-label={t("shell.panelTabs")} className="shrink-0 gap-2 border-b-0">
                <Tab
                  variant="inline"
                  active={tab === "graph"}
                  onClick={() => setTab("graph")}
                  icon={<GitCommitVertical className="w-3.5 h-3.5" />}
                  count={badgeCount(data.newCount)}
                >
                  {t("shell.graphTab")}
                </Tab>
                <Tab
                  variant="inline"
                  active={tab === "files"}
                  onClick={() => setTab("files")}
                  icon={<Files className="w-3.5 h-3.5" />}
                  count={badgeCount(branchChanges.count)}
                >
                  {branchChanges.label}
                </Tab>
              </TabGroup>
              <span className="flex-1" />
              {tab === "files" && <FilesGroupByPicker value={groupBy} onChange={setGroupBy} />}
              <RepoLegend repos={data.visible} />
              {data.hiddenCount > 0 || showAll ? (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  title={t("review.hiddenHint")}
                  className="shrink-0 h-6 px-2 rounded-(--radius-chip) text-[11.5px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  {showAll ? t("review.hideQuiet") : t("review.showAll", { count: data.hiddenCount })}
                </button>
              ) : null}
              {tab === "graph" && data.newCount > 0 && (
                <>
                  <span className="w-px h-[18px] bg-(--line) mx-1 shrink-0" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={data.markSeen}
                    className="shrink-0 h-6 px-2.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent transition-colors"
                  >
                    {t("graph.markSeen", { count: data.newCount })}
                  </button>
                </>
              )}
            </div>
            {tab === "graph" && (
              <RepoLaneCommitGraph
                graph={data.graph}
                lanePaths={data.lanePaths}
                repoLabel={repoLabel}
                selectedKey={selection?.key ?? null}
                seenAt={data.seenAt}
                baseTime={data.baseTime}
                baseBranchLabel={data.baseBranchLabel}
                isLoading={data.isLoading}
                emptyMessage={emptyMessage}
                onSelectCommit={(repoPath, commit, key) =>
                  setSelection({ kind: "commit", key, repoPath, oid: commit.id })
                }
                onSelectWip={(wip, key) =>
                  setSelection({
                    kind: "wip",
                    key,
                    repoPath: wip.repoPath,
                    path: wip.path,
                    branch: wip.branch,
                    isMain: wip.isMain,
                  })
                }
              />
            )}
          </section>
          }
          bottom={
            tab === "graph" ? (
              <Card className="flex-1">
                <ReviewFilesPanel selection={selection} repoLabel={repoLabel} />
              </Card>
            ) : (
              <FilesByRepo repos={filesRepos} groupBy={groupBy} />
            )
          }
        />
      )}
    </div>
  );
}

/** 저장소의 기준(main) 상태를 한 줄로. 갈라진 지점을 못 찾았거나 잘렸을 때만 문구가 있다. */
function historyNote(t: TFunction, h: WorkspaceRepoHistory | undefined): string | null {
  if (!h || h.error) return null;
  if (h.baseStatus === "noDefaultBranch") return t("review.noDefaultBranch");
  if (h.baseStatus === "noSharedHistory") return t("review.noSharedHistory", { branch: h.defaultBranch ?? "main" });
  if (h.truncated) return t("review.truncated", { count: h.commits.length });
  return null;
}

/** 그래프 머리의 저장소 표시: 레인 색, 저장소 이름, 지금 브랜치. 읽지 못한 저장소는 경고로 표시한다. */
function RepoLegend({ repos }: { repos: ReviewRepo[] }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-1.5 min-w-0 overflow-x-auto" data-testid="repo-legend">
      {repos.map((r) => {
        const color = repoLaneColor(r.path);
        const note = historyNote(t, r.history);
        const worktreeNote =
          r.worktreeNewCount > 0 ? t("review.worktreeNew", { count: r.worktreeNewCount }) : null;
        const title = r.error
          ? t("review.repoError", { repo: r.name, error: r.error })
          : [note, worktreeNote].filter(Boolean).join("\n") || r.path;
        return (
          <span
            key={r.path}
            title={title}
            data-repo={r.path}
            className="flex items-center gap-1.5 shrink-0 h-[22px] px-2 rounded-[6px] text-[11px] font-bold"
            style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
          >
            {r.error ? (
              <AlertTriangle className="w-3 h-3 text-danger" aria-label={t("review.repoError", { repo: r.name, error: r.error })} />
            ) : (
              <span className="w-2 h-0.5" style={{ background: color }} aria-hidden="true" />
            )}
            {r.name}
            {r.branch && <span className="font-mono font-medium opacity-80">{r.branch}</span>}
            {note && <span className="opacity-70" aria-hidden="true">*</span>}
            {worktreeNote && (
              <span
                className="px-1 rounded-[4px] bg-(--acc-sel) text-(--acc) text-[10px] font-bold"
                aria-label={worktreeNote}
                data-testid="worktree-new"
              >
                +{r.worktreeNewCount}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/**
 * 툴바 왼쪽의 제목 자리(`ToolbarRoot`의 `data-toolbar-title-slot`). 시안처럼 제목을 툴바 줄에
 * 둔다. 툴바가 없으면(테스트 등) null이고, 그때는 제목을 화면 맨 위에 그린다.
 */
function useToolbarTitleSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setSlot(document.querySelector<HTMLElement>("[data-toolbar-title-slot]"));
  }, []);
  return slot;
}
