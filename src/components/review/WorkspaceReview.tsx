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
import { RepoLaneCommitGraph } from "@/components/graph/CommitGraph";
import { repoLaneColor } from "@/components/graph/repo-lanes";
import { useScopeStore } from "@/components/scope/scope-store";
import { ScopeViewToggle } from "@/components/scope/ScopeViewToggle";
import type { WorkspaceRepoHistory } from "@/types";
import { WorkspaceTitle } from "./WorkspaceTitle";
import { ReviewFilesPanel, type ReviewSelection } from "./ReviewFilesPanel";
import { FileTouchesView } from "./FileTouchesView";
import { fileTouchSources } from "./file-touches-model";
import { WorkSwitcher } from "@/components/commit/WorkSwitcher";
import type { RepoLaneGraph } from "@/components/graph/repo-lanes";
import { useWorkspaceReview, type ReviewRepo } from "./useWorkspaceReview";
import { useReviewActivityRefresh } from "./useReviewActivityRefresh";

type CommitSelection = Extract<ReviewSelection, { kind: "commit" }>;

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
  const rememberSelection = useScopeStore((s) => s.rememberSelection);
  const [selection, setSelection] = useState<ReviewSelection>(null);
  const reviewView = useUIStore((s) => s.reviewFileView);
  // 저장소마다 마지막으로 고른 커밋. 「작업 중인 변경」으로 갔다가 「커밋」 칸으로 돌아올 때 쓴다.
  const [lastCommitByRepo, setLastCommitByRepo] = useState<Readonly<Record<string, CommitSelection>>>({});

  const data = useWorkspaceReview(paths, repoShown);
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

  // 저장소·브랜치 단계에서 고른 커밋이 이 워크스페이스의 레인(저장소 메인 작업 트리)에 있으면 그 행을
  // 고른 채로 들어온다(5.1 「선택」, `carrySelection`과 같은 규칙). 그래프를 읽은 뒤 한 번만 본다.
  const [carryChecked, setCarryChecked] = useState(false);
  if (!carryChecked && data.graph.rows.length > 0) {
    setCarryChecked(true);
    const last = useScopeStore.getState().lastSelection;
    const row = last?.commitOid
      ? data.graph.rows.find((r) => r.kind === "commit" && r.repoPath === last.laneId && r.commit.id === last.commitOid)
      : undefined;
    if (row?.kind === "commit") setSelection({ kind: "commit", key: row.key, repoPath: row.repoPath, oid: row.commit.id });
  }

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

  const pick = (next: ReviewSelection) => {
    setSelection(next);
    // 저장소·브랜치 단계로 내려가도 같은 커밋을 고른 채로 둔다(`carrySelection`). 워크스페이스 레인의
    // 커밋은 그 저장소의 메인 작업 트리 이력이다.
    rememberSelection(next?.kind === "commit" ? { laneId: next.repoPath, commitOid: next.oid } : null);
  };

  const graphCard = (
    <WorkspaceGraphCard
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
      {filesView ? (
        <FileTouchesView sources={fileSources} repoLabel={repoLabel} />
      ) : (
        <RepoLaneCommitGraph
          graph={data.graph}
          lanePaths={data.lanePaths}
          repoLabel={repoLabel}
          selectedKey={selection?.key ?? null}
          baseTime={data.baseTime}
          baseBranchLabel={data.baseBranchLabel}
          remoteLabel={data.remoteName ?? t("graph.anyRemote")}
          isLoading={data.isLoading}
          emptyMessage={emptyMessage}
          onSelectCommit={(repoPath, commit, key) => {
            const picked: CommitSelection = { kind: "commit", key, repoPath, oid: commit.id };
            pick(picked);
            setLastCommitByRepo((prev) => ({ ...prev, [repoPath]: picked }));
          }}
          onSelectWip={(wip, key) =>
            pick({
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
          hasSelection={!filesView && selection !== null}
          bottom={
            <Card className="flex-1">
              <ReviewFilesPanel
                selection={selection}
                repoLabel={repoLabel}
                switcher={
                  <WorkspaceWorkSwitcher
                    selection={selection}
                    graph={data.graph}
                    lastCommit={selection ? (lastCommitByRepo[selection.repoPath] ?? null) : null}
                    onSelect={pick}
                  />
                }
              />
            </Card>
          }
        />
      )}
    </div>
  );
}

/**
 * 워크스페이스 그래프 카드. `PaneStrip` 안에서 그려져야 2단계(좁은 커밋 목록)인지 안다 — 그때는 필터
 * 막대 대신 「그래프 펼치기」 머리 줄만 둔다(D47).
 */
function WorkspaceGraphCard({ filterBar, children }: { filterBar: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  const narrow = useGraphNarrow();
  return (
    <section
      aria-label={t("shell.graphTab")}
      className="relative flex flex-col h-full min-h-0 bg-card rounded-(--radius-panel) shadow-(--shadow) overflow-hidden"
    >
      {narrow ? <NarrowPaneHeader label={t("shell.graphTab")} /> : filterBar}
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
