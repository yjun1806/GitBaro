import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, Folder } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useWorkspaceStore } from "@/stores/workspace";
import { useUIStore } from "@/stores/ui";
import { repoAccountsByPath } from "@/lib/repo-tree";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { FilterChip } from "@/components/ui/FilterChip";
import { PaneStrip } from "@/components/layout/PaneStrip";
import { NarrowPaneHeader } from "@/components/layout/NarrowPaneHeader";
import { useGraphNarrow } from "@/components/layout/pane-state";
import { repoLaneColor } from "@/components/graph/repo-lanes";
import { useScopeStore } from "@/components/scope/scope-store";
import { ScopeViewToggle } from "@/components/scope/ScopeViewToggle";
import type { WorkspaceRepoHistory } from "@/types";
import { WorkspaceTitle } from "./WorkspaceTitle";
import { LaneGraphBody, LaneViewerBottom, useLaneSelection } from "./lane-viewer";
import { fileTouchSources } from "./file-touches-model";
import { useWorkspaceReview, type ReviewRepo } from "./useWorkspaceReview";
import { useReviewActivityRefresh } from "./useReviewActivityRefresh";

export interface WorkspaceReviewProps {
  workspaceId: string;
  /** 워크스페이스에 지금 드는 저장소 경로(`useActiveScope`의 `paths`). */
  paths: string[];
}

/**
 * 워크스페이스 단계의 메인 칸(5.1). 저장소·브랜치 단계와 같은 틀이다: 필터 막대(저장소 칩 ·
 * 커밋 순서|파일별) 아래 저장소마다 레인인 커밋 그래프, 행을 고르면 옆 칸(`PaneStrip`)에 그 커밋이나
 * 커밋하지 않은 변경의 파일 목록과 diff. 탭은 없다. 조용한 저장소(기본 브랜치에 있고 원격에 없는
 * 커밋·커밋하지 않은 변경이 없음)의 칩은 꺼진 채로 시작한다(D43).
 */
export function WorkspaceReview({ workspaceId, paths }: WorkspaceReviewProps) {
  const { t } = useTranslation();
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const repos = useRepositoryStore((s) => s.repos);
  const accounts = useAccountStore((s) => s.accounts);
  const repoShown = useScopeStore((s) => s.repoShown);
  const setRepoShown = useScopeStore((s) => s.setRepoShown);
  const reviewView = useUIStore((s) => s.reviewFileView);

  const data = useWorkspaceReview(paths, repoShown);
  // 고른 행. 저장소·브랜치 단계에서 고른 커밋이 이 워크스페이스의 레인(저장소 메인 작업 트리)에 있으면
  // 그 행을 고른 채로 들어온다(5.1 「선택」, `carrySelection`과 같은 규칙).
  const lanes = useLaneSelection(data.graph);
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
  const filesView = reviewView === "files";

  const graphCard = (
    <WorkspaceGraphCard
      onCloseNarrow={() => lanes.pick(null)}
      filterBar={
        <FilterBar
          left={
            <RepoChips
              repos={data.repos}
              visible={data.visible}
              onToggle={(repo, shown) => setRepoShown(repo.path, shown)}
            />
          }
          right={<ScopeViewToggle />}
        />
      }
    >
      <LaneGraphBody
        lanes={lanes}
        filesView={filesView}
        fileSources={fileSources}
        graph={data.graph}
        lanePaths={data.lanePaths}
        repoLabel={repoLabel}
        baseTime={data.baseTime}
        baseBranchLabel={data.baseBranchLabel}
        remoteName={data.remoteName}
        isLoading={data.isLoading}
        emptyMessage={emptyMessage}
      />
    </WorkspaceGraphCard>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-(--g) animate-content-in">
      {titleSlot ? createPortal(title, titleSlot) : title}
      {data.repos.length === 0 ? (
        <Card className="flex-1">
          <EmptyState icon={Folder} title={t("review.emptyTitle")} description={t("review.emptyHint")} />
        </Card>
      ) : (
        <PaneStrip
          graph={graphCard}
          // 파일별 보기는 그래프 칸 안에 파일 목록과 diff를 함께 그리므로 옆 칸을 열지 않는다(5.4).
          hasSelection={!filesView && lanes.selection !== null}
          bottom={<LaneViewerBottom lanes={lanes} graph={data.graph} repoLabel={repoLabel} />}
        />
      )}
    </div>
  );
}

/**
 * 워크스페이스 그래프 카드. `PaneStrip` 안에서 그려져야 2단계(좁은 커밋 목록)인지 안다 — 그때는 필터
 * 막대 대신 「목록 닫고 그래프 넓게 보기」 머리 줄만 둔다(D47).
 */
function WorkspaceGraphCard({
  filterBar,
  onCloseNarrow,
  children,
}: {
  filterBar: ReactNode;
  onCloseNarrow: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const narrow = useGraphNarrow();
  return (
    <section
      aria-label={t("shell.graphTab")}
      className="relative flex flex-col h-full min-h-0 bg-card rounded-(--radius-panel) shadow-(--shadow) overflow-hidden"
    >
      {narrow ? <NarrowPaneHeader label={t("shell.graphTab")} onClose={onCloseNarrow} /> : filterBar}
      {children}
    </section>
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

/**
 * 필터 막대의 저장소 칩(5.1 「레인 칩: 저장소」, D43). 견본 색이 그래프의 레인 색이다. 조용한 저장소는
 * 꺼진 채로 시작하고, 읽지 못한 저장소는 경고 아이콘과 이유를 단다. 수는 싣지 않는다 — 올릴 커밋 수는
 * 사이드바가 말한다.
 */
function RepoChips({
  repos,
  visible,
  onToggle,
}: {
  repos: readonly ReviewRepo[];
  visible: readonly ReviewRepo[];
  onToggle: (repo: ReviewRepo, shown: boolean) => void;
}) {
  const { t } = useTranslation();
  const shown = new Set(visible.map((r) => r.path));
  return (
    <div
      role="group"
      aria-label={t("review.repoChipsLabel")}
      className="flex items-center gap-1.5 min-w-0 overflow-x-auto"
      data-testid="repo-chips"
    >
      {repos.map((r) => {
        const on = shown.has(r.path);
        const note = historyNote(t, r.history);
        const title = r.error
          ? t("review.repoError", { repo: r.name, error: r.error })
          : [r.branch ?? r.path, note, r.quiet ? t("review.quietChipHint") : null].filter(Boolean).join(" · ");
        return (
          <FilterChip
            key={r.path}
            pressed={on}
            swatchColor={repoLaneColor(r.path)}
            icon={
              r.error ? <AlertTriangle className="w-3 h-3 shrink-0 text-danger" aria-hidden="true" /> : undefined
            }
            title={title}
            onClick={() => onToggle(r, !on)}
          >
            {r.name}
          </FilterChip>
        );
      })}
    </div>
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
