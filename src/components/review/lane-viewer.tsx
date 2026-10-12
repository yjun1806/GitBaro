import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { RepoLaneCommitGraph } from "@/components/graph/CommitGraph";
import type { LaneWip, RepoLaneGraph } from "@/components/graph/repo-lanes";
import { WorkSwitcher } from "@/components/commit/WorkSwitcher";
import { useFollowStore } from "@/stores/follow";
import { useScopeStore } from "@/components/scope/scope-store";
import type { CommitInfo, WorkflowRun } from "@/types";
import { ReviewFilesPanel, type ReviewSelection } from "./ReviewFilesPanel";
import { FileTouchesView } from "./FileTouchesView";
import type { FileTouchSource } from "./file-touches-model";

/**
 * 레인 뷰어의 틀. 워크스페이스(레인 = 저장소)와 저장소(레인 = 워크트리) 단계가 함께 쓴다 — 그래프 몸통
 * (커밋 순서 | 파일별), 고른 행을 담는 상태, 옆 칸의 [작업 중인 변경 | 커밋] 전환. 레인 id는 그래프
 * 행의 `repoPath`다(워크스페이스는 저장소 경로, 저장소 단계는 워크트리 경로).
 */

export type CommitSelection = Extract<ReviewSelection, { kind: "commit" }>;

export interface LaneSelectionApi {
  selection: ReviewSelection;
  /** 레인마다 마지막으로 고른 커밋. 「작업 중인 변경」으로 갔다가 「커밋」 칸으로 돌아올 때 쓴다. */
  lastCommitByLane: Readonly<Record<string, CommitSelection>>;
  pick: (next: ReviewSelection) => void;
  /** 고른 행을 비우고, 이어받을 커밋을 다시 찾게 한다(화면에 다시 들어올 때). */
  reset: () => void;
  pickCommit: (laneId: string, commit: CommitInfo, key: string) => void;
  pickWip: (wip: LaneWip, key: string) => void;
}

/**
 * 고른 행과 그것을 단계 사이로 잇는 기억. 커밋을 고르면 (레인, 커밋)을 `lastSelection`에 적어, 아래 단계로
 * 내려가도 같은 커밋을 고른 채로 있게 한다(`carrySelection`과 같은 규칙). 처음 그래프를 읽었을 때 이어받을
 * 커밋이 이 그래프에 있으면 그 행을 고른 채로 들어온다. `ready`가 false인 동안(커밋을 아직 읽는 중)에는
 * 찾지 않는다 — WIP 행만 먼저 그려진 그래프에서 이어받을 기회를 놓치지 않게 한다.
 */
export function useLaneSelection(graph: RepoLaneGraph, ready = true): LaneSelectionApi {
  const rememberSelection = useScopeStore((s) => s.rememberSelection);
  const [selection, setSelection] = useState<ReviewSelection>(null);
  const [lastCommitByLane, setLastCommitByLane] = useState<Readonly<Record<string, CommitSelection>>>({});

  const [carryChecked, setCarryChecked] = useState(false);
  if (!carryChecked && ready && graph.rows.length > 0) {
    setCarryChecked(true);
    const last = useScopeStore.getState().lastSelection;
    const row = last?.commitOid
      ? graph.rows.find((r) => r.kind === "commit" && r.repoPath === last.laneId && r.commit.id === last.commitOid)
      : undefined;
    if (row?.kind === "commit") setSelection({ kind: "commit", key: row.key, repoPath: row.repoPath, oid: row.commit.id });
  }

  const pick = useCallback(
    (next: ReviewSelection) => {
      setSelection(next);
      rememberSelection(next?.kind === "commit" ? { laneId: next.repoPath, commitOid: next.oid } : null);
    },
    [rememberSelection],
  );
  const reset = useCallback(() => {
    setSelection(null);
    setLastCommitByLane({});
    setCarryChecked(false);
  }, []);
  const pickCommit = useCallback(
    (laneId: string, commit: CommitInfo, key: string) => {
      const picked: CommitSelection = { kind: "commit", key, repoPath: laneId, oid: commit.id };
      pick(picked);
      setLastCommitByLane((prev) => ({ ...prev, [laneId]: picked }));
    },
    [pick],
  );
  const pickWip = useCallback(
    (wip: LaneWip, key: string) =>
      pick({ kind: "wip", key, repoPath: wip.repoPath, path: wip.path, branch: wip.branch, isMain: wip.isMain }),
    [pick],
  );
  return { selection, lastCommitByLane, pick, reset, pickCommit, pickWip };
}

export interface LaneGraphBodyProps {
  lanes: LaneSelectionApi;
  /** 「파일별」 보기인가. */
  filesView: boolean;
  fileSources: readonly FileTouchSource[];
  graph: RepoLaneGraph;
  lanePaths: readonly string[];
  /** 레인 id → 행 앞에 붙일 짧은 이름. 파일별 보기에서는 저장소 경로를 받는다. */
  repoLabel: (laneId: string) => string;
  /** 파일별 보기가 쓰는 이름표(저장소 경로 → 이름). 없으면 `repoLabel`. */
  fileRepoLabel?: (repoPath: string) => string;
  baseTime: number | null;
  baseBranchLabel: string;
  remoteName: string | null;
  isLoading: boolean;
  emptyMessage?: string;
  ciRuns?: readonly WorkflowRun[];
  ownerOf?: (laneId: string) => string;
  onWipContextMenu?: (wip: LaneWip, position: { x: number; y: number }) => void;
}

/** 필터 막대 아래의 몸통: 파일별이면 `FileTouchesView`, 아니면 레인 커밋 그래프. */
export function LaneGraphBody({
  lanes,
  filesView,
  fileSources,
  graph,
  lanePaths,
  repoLabel,
  fileRepoLabel = repoLabel,
  baseTime,
  baseBranchLabel,
  remoteName,
  isLoading,
  emptyMessage,
  ciRuns,
  ownerOf,
  onWipContextMenu,
}: LaneGraphBodyProps) {
  const { t } = useTranslation();
  if (filesView) return <FileTouchesView sources={fileSources} repoLabel={fileRepoLabel} />;
  return (
    <RepoLaneCommitGraph
      graph={graph}
      lanePaths={lanePaths}
      repoLabel={repoLabel}
      selectedKey={lanes.selection?.key ?? null}
      baseTime={baseTime}
      baseBranchLabel={baseBranchLabel}
      remoteLabel={remoteName ?? t("graph.anyRemote")}
      isLoading={isLoading}
      emptyMessage={emptyMessage}
      ciRuns={ciRuns}
      ownerOf={ownerOf}
      onWipContextMenu={onWipContextMenu}
      onSelectCommit={lanes.pickCommit}
      onSelectWip={lanes.pickWip}
    />
  );
}

export interface LaneViewerBottomProps {
  lanes: LaneSelectionApi;
  graph: RepoLaneGraph;
  repoLabel: (laneId: string) => string;
  /** 레인 id → 그 레인이 속한 저장소 경로(커밋하러 저장소 화면을 열 때). 없으면 레인 id가 저장소 경로다. */
  ownerOf?: (laneId: string) => string;
}

/** 옆 칸: 고른 커밋의 상세나 고른 워크트리의 따라가기, 그리고 [작업 중인 변경 | 커밋] 전환. */
export function LaneViewerBottom({ lanes, graph, repoLabel, ownerOf }: LaneViewerBottomProps) {
  const { selection } = lanes;
  return (
    <Card className="flex-1">
      <ReviewFilesPanel
        selection={selection}
        repoLabel={repoLabel}
        ownerOf={ownerOf}
        switcher={
          <LaneWorkSwitcher
            selection={selection}
            graph={graph}
            lastCommit={selection ? (lanes.lastCommitByLane[selection.repoPath] ?? null) : null}
            onSelect={lanes.pick}
          />
        }
      />
    </Card>
  );
}

/**
 * 아래 칸의 [작업 중인 변경 N | 커밋 <sha>] 전환. 고른 레인 기준이다: 커밋을 골랐으면 첫 칸은 그 레인의
 * WIP 행으로, WIP를 골랐으면 둘째 칸은 그 레인에서 마지막으로 고른 커밋으로 간다. 커밋 안 한 변경이 없거나
 * 고른 커밋이 없으면 그 칸을 끈다.
 */
function LaneWorkSwitcher({
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
        // WIP 행을 누른 것과 같다: 그 워크트리를 따라가며 보여 준다.
        useFollowStore.getState().start(wipRow.wip.path);
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
