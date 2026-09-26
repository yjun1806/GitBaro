import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, Folder } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useWorkspaceStore } from "@/stores/workspace";
import { useUIStore, type ReviewFileView } from "@/stores/ui";
import { repoAccountsByPath } from "@/lib/repo-tree";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { GraphSplit } from "@/components/layout/GraphSplit";
import { RepoLaneCommitGraph, RepoLaneTag } from "@/components/graph/CommitGraph";
import { Button } from "@/components/ui/Button";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import type { WorkspaceRepoHistory } from "@/types";
import { WorkspaceTitle } from "./WorkspaceTitle";
import { StatusActivity } from "./StatusActivity";
import { ReviewFilesPanel, type ReviewSelection } from "./ReviewFilesPanel";
import { FileTouchesView } from "./FileTouchesView";
import { fileTouchSources } from "./file-touches-model";
import { WorkSwitcher } from "@/components/commit/WorkSwitcher";
import type { RepoLaneGraph } from "@/components/graph/repo-lanes";

type CommitSelection = Extract<ReviewSelection, { kind: "commit" }>;
import { useWorkspaceReview, type ReviewRepo } from "./useWorkspaceReview";
import { useReviewActivityRefresh } from "./useReviewActivityRefresh";

export interface WorkspaceReviewProps {
  workspaceId: string;
  /** 워크스페이스에 지금 드는 저장소 경로(`useActiveScope`의 `paths`). */
  paths: string[];
}

/**
 * 워크스페이스를 고른 상태의 메인 칸(D1). 제목, 여러 저장소 커밋 그래프(저장소별 레인),
 * 아래에 고른 커밋이나 커밋하지 않은 변경의 파일 목록과 diff.
 * 조용한 저장소(main에 있고 원격에 없는 커밋·커밋하지 않은 변경이 없음)는 접고 「모두 보기」로 펼친다.
 */
export function WorkspaceReview({ workspaceId, paths }: WorkspaceReviewProps) {
  const { t } = useTranslation();
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const repos = useRepositoryStore((s) => s.repos);
  const accounts = useAccountStore((s) => s.accounts);
  const [showAll, setShowAll] = useState(false);
  const [selection, setSelection] = useState<ReviewSelection>(null);
  const reviewView = useUIStore((s) => s.reviewFileViewByWorkspace[workspaceId] ?? "commits");
  const setReviewFileView = useUIStore((s) => s.setReviewFileView);
  // 저장소마다 마지막으로 고른 커밋. 「작업 중인 변경」으로 갔다가 「커밋」 칸으로 돌아올 때 쓴다.
  const [lastCommitByRepo, setLastCommitByRepo] = useState<Readonly<Record<string, CommitSelection>>>({});

  const data = useWorkspaceReview(paths, showAll);
  useReviewActivityRefresh(data.repoPaths);

  const accountLabel = useMemo(() => {
    const byPath = repoAccountsByPath(repos, accounts);
    const known = paths.map((p) => byPath.get(p)).find((a) => a && !a.pending);
    return known?.label ?? workspace?.accountKey ?? "";
  }, [repos, accounts, paths, workspace?.accountKey]);

  const nameByPath = useMemo(() => new Map(data.repos.map((r) => [r.path, r.name])), [data.repos]);
  const repoLabel = useCallback((path: string) => nameByPath.get(path) ?? path, [nameByPath]);
  // 파일별 보기는 보이는 저장소의 모든 워크트리를 읽는다(숨김 규칙도 모든 워크트리의 원격에 없는 커밋을 센다).
  // `data.visible`은 그릴 때마다 새 배열이라, 대상이 실제로 바뀔 때만 새 목록을 넘긴다.
  const nextFileSources = fileTouchSources(data.visible);
  const fileSourcesKey = JSON.stringify(nextFileSources);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fileSourcesKey가 nextFileSources의 내용을 대신 비교한다
  const fileSources = useMemo(() => nextFileSources, [fileSourcesKey]);

  const titleSlot = useToolbarTitleSlot();

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
    <div className="flex flex-col flex-1 min-h-0 gap-(--g) animate-content-in">
      {titleSlot ? createPortal(title, titleSlot) : title}
      {data.repos.length === 0 ? (
        <Card className="flex-1">
          <EmptyState icon={Folder} title={t("review.emptyTitle")} description={t("review.emptyHint")} />
        </Card>
      ) : (
        <GraphSplit
          topCollapsed={reviewView === "files"}
          top={
          <section
            aria-label={t("shell.panelTabs")}
            className="relative flex flex-col shrink-0 flex-1 min-h-0 bg-card rounded-(--radius-panel) shadow-(--shadow) overflow-hidden"
          >
            <div className="flex items-center gap-2 min-h-8 pl-3 pr-3 shrink-0 border-b border-(--line)">
              {/* 탭이 하나뿐이라 탭 줄 대신 제목만 둔다(카드 머리, 디자인 시스템 3.5). */}
              <span className="shrink-0 text-[12.5px] font-bold text-foreground">{t("shell.graphTab")}</span>
              <Segmented
                value={reviewView}
                onChange={(v) => setReviewFileView(workspaceId, v)}
                size="sm"
                ariaLabel={t("review.fileView.viewLabel")}
                options={REVIEW_VIEW_OPTIONS(t)}
              />
              <span className="flex-1" />
              <RepoLegend repos={data.visible} />
              {data.hiddenCount > 0 || showAll ? (
                <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} title={t("review.hiddenHint")}>
                  {showAll ? t("review.hideQuiet") : t("review.showAll", { count: data.hiddenCount })}
                </Button>
              ) : null}
              {/* 저장소 화면의 git 상태 줄과 같은 자리: 오프라인 표시, 도는 git 명령, 작업 기록 열기. */}
              <StatusActivity />
            </div>
            {reviewView === "commits" && (
              <RepoLaneCommitGraph
                graph={data.graph}
                lanePaths={data.lanePaths}
                repoLabel={repoLabel}
                selectedKey={selection?.key ?? null}
                baseTime={data.baseTime}
                baseBranchLabel={data.baseBranchLabel}
                isLoading={data.isLoading}
                emptyMessage={emptyMessage}
                onSelectCommit={(repoPath, commit, key) => {
                  const picked: CommitSelection = { kind: "commit", key, repoPath, oid: commit.id };
                  setSelection(picked);
                  setLastCommitByRepo((prev) => ({ ...prev, [repoPath]: picked }));
                }}
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
            <Card className="flex-1">
              {reviewView === "commits" ? (
                <ReviewFilesPanel
                  selection={selection}
                  repoLabel={repoLabel}
                  switcher={
                    <WorkspaceWorkSwitcher
                      selection={selection}
                      graph={data.graph}
                      lastCommit={selection ? (lastCommitByRepo[selection.repoPath] ?? null) : null}
                      onSelect={setSelection}
                    />
                  }
                />
              ) : (
                <FileTouchesView sources={fileSources} repoLabel={repoLabel} />
              )}
            </Card>
          }
        />
      )}
    </div>
  );
}

/** 그래프 카드 머리의 [커밋 순서 | 파일별] 전환 선택지. */
function REVIEW_VIEW_OPTIONS(t: TFunction): SegmentedOption<ReviewFileView>[] {
  return [
    { value: "commits", label: t("review.fileView.segCommits") },
    { value: "files", label: t("review.fileView.segFiles") },
  ];
}

/** 저장소의 기준(main) 상태를 한 줄로. 갈라진 지점을 못 찾았거나 잘렸을 때만 문구가 있다. */
function historyNote(t: TFunction, h: WorkspaceRepoHistory | undefined): string | null {
  if (!h || h.error) return null;
  if (h.baseStatus === "noDefaultBranch") return t("review.noDefaultBranch");
  if (h.baseStatus === "noSharedHistory") return t("review.noSharedHistory", { branch: h.defaultBranch ?? "main" });
  if (h.truncated) return t("review.truncated", { count: h.commits.length });
  return null;
}

/**
 * 그래프 머리의 저장소 표시: 레인 색, 저장소 이름, 지금 브랜치. 읽지 못한 저장소는 경고로 표시한다.
 * 저장소 이름표는 그래프 행·WIP 행과 같은 `RepoLaneTag`(레인 색을 입힌 `RefLabel`, D4)를 쓴다.
 */
function RepoLegend({ repos }: { repos: ReviewRepo[] }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-2 min-w-0 overflow-x-auto" data-testid="repo-legend">
      {repos.map((r) => {
        const note = historyNote(t, r.history);
        const title = r.error
          ? t("review.repoError", { repo: r.name, error: r.error })
          : (note ?? r.path);
        return (
          <span
            key={r.path}
            title={title}
            data-repo={r.path}
            className="flex items-center gap-1 shrink-0 text-[11.5px] text-muted-foreground"
          >
            <RepoLaneTag repoPath={r.path} label={r.name} />
            {r.error && (
              <AlertTriangle
                className="w-3 h-3 text-danger"
                aria-label={t("review.repoError", { repo: r.name, error: r.error })}
              />
            )}
            {r.branch && <span className="font-mono">{r.branch}</span>}
            {note && <span aria-hidden="true">*</span>}
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

/**
 * 워크스페이스 아래 칸의 [작업 중인 변경 N | 커밋 <sha>] 전환. 고른 저장소 기준이다: 커밋을 골랐으면
 * 첫 칸은 그 저장소(메인 작업 트리 먼저)의 WIP 행으로, WIP를 골랐으면 둘째 칸은 그 저장소에서 마지막으로
 * 고른 커밋으로 간다. 커밋 안 한 변경이 없거나 고른 커밋이 없으면 그 칸을 끈다.
 */
function WorkspaceWorkSwitcher({
  selection,
  graph,
  lastCommit,
  onSelect,
}: {
  selection: ReviewSelection;
  graph: RepoLaneGraph;
  lastCommit: CommitSelection | null;
  onSelect: (selection: ReviewSelection) => void;
}) {
  const { t } = useTranslation();
  if (selection === null) return null;
  const wipRows = graph.rows.flatMap((r) => (r.kind === "wip" && r.repoPath === selection.repoPath ? [r] : []));
  const wipRow =
    selection.kind === "wip"
      ? (wipRows.find((r) => r.wip.path === selection.path) ?? null)
      : (wipRows.find((r) => r.wip.isMain) ?? wipRows[0] ?? null);
  const commit = selection.kind === "commit" ? selection : lastCommit;
  return (
    <WorkSwitcher
      mode={selection.kind === "commit" ? "commit" : "working"}
      workingCount={wipRow?.wip.count ?? 0}
      workingDisabledReason={wipRow || selection.kind === "wip" ? null : t("workSwitcher.noWorkingHint")}
      workingDisabledLabel={t("workSwitcher.working", { count: 0 })}
      commitShortId={commit ? commit.oid.slice(0, 7) : null}
      onWorking={() => {
        if (!wipRow) return;
        onSelect({
          kind: "wip",
          key: wipRow.key,
          repoPath: wipRow.repoPath,
          path: wipRow.wip.path,
          branch: wipRow.wip.branch,
          isMain: wipRow.wip.isMain,
        });
      }}
      onCommit={() => {
        if (commit) onSelect(commit);
      }}
    />
  );
}
