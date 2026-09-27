import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FileText, GitCommit, Archive, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import {
  useStatus,
  useFileDiff,
  useCommitDetail,
  useCommitFileDiff,
  useCommitAvatars,
  useMergeState,
  useCachedRepoSyncStatus,
} from "@/api/queries";
import { trimTrailingSlash } from "@/lib/utils";
import { RefLabel } from "@/components/ui/marks";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { CommitDetail } from "@/components/history/CommitDetail";
import { StashDetailView } from "@/components/stash/StashDetailView";
import { ActionsDetailView } from "@/components/actions/ActionsDetailView";
import { ChangesView } from "@/components/commit/ChangesView";
import { SwitchingOverlay } from "@/components/ui/SwitchingOverlay";
import { FollowPanel, FollowRepoFooter } from "@/components/live/FollowPanel";
import { useFollowStore } from "@/stores/follow";
import { parseWorkingFileKey, workingFileItems, workingFileKey } from "@/components/commit/working-files";
import { useWorkingFileMenu } from "@/components/commit/useWorkingFileMenu";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { ListDiffSplit } from "./ListDiffSplit";
import type { MaximizedFiles, MaximizedOrigin } from "./maximized-files";
import type { FileStatus } from "@/types";
import { LoadingState } from "@/components/ui/LoadingState";

// `Card`·`EmptyState`는 `ui/`로 옮겼다. 옛 경로를 쓰는 곳이 있어 재수출로 남겨 둔다.
export { Card, EmptyState };

type MainTab = "changes" | "history" | "stash" | "actions";

/**
 * 2단계의 접힌 그래프 칸(`PaneStrip`)을 눌렀을 때 지금 탭의 파일 선택을 지운다(1단계로). 네 탭 모두
 * "아무것도 안 골랐음"에도 늘 무언가 보여 주므로(스태시·Actions의 "고르지 않음" 안내, 스테이징
 * 목록 자체) 0단계(그래프 전체)로 돌아가지는 않는다 — `CommitDetail` 등 상세 화면이 파일 선택을
 * 안에 갇힌 상태로 들고 있어 그 화면만 골라 파일을 닫는 것도 못 하므로, 변경 탭은 따라가기를
 * 끝내고(스테이징 목록으로) 이력 탭은 커밋 자체를 지운다.
 */
export function useExpandGraph(activeTab: MainTab): () => void {
  const stopFollow = useFollowStore((s) => s.stop);
  const clearFileSelection = useSelectionStore((s) => s.clearFileSelection);
  const clearCommitSelection = useSelectionStore((s) => s.clearCommitSelection);
  const clearStashSelection = useSelectionStore((s) => s.clearStashSelection);
  const clearRunSelection = useSelectionStore((s) => s.clearRunSelection);
  return useCallback(() => {
    if (activeTab === "changes") {
      stopFollow();
      clearFileSelection();
    } else if (activeTab === "history") {
      clearCommitSelection();
    } else if (activeTab === "stash") {
      clearStashSelection();
    } else {
      clearRunSelection();
    }
  }, [activeTab, stopFollow, clearFileSelection, clearCommitSelection, clearStashSelection, clearRunSelection]);
}

function DiffContent({ filePath, staged }: { filePath: string; staged: boolean }) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: diff, isLoading, isError } = useFileDiff(activeRepoPath, filePath, staged);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);

  // 일부만 스테이징된 파일은 두 행이 있으므로 섹션(staged)까지 맞는 행을 쓴다.
  const fileStatus: FileStatus =
    statusEntries.find((e) => e.path === filePath && e.staged === staged)?.status ?? "modified";

  if (isLoading) {
    return <LoadingState label={t("diff.loadingDiff")} />;
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center p-3">
        <Notice tone="danger">{t("diff.failedToLoad")}</Notice>
      </div>
    );
  }

  return <DiffViewer diff={diff ?? null} status={fileStatus} staged={staged} maximizable repoPath={activeRepoPath} />;
}

function CommitDetailView({ commitId }: { commitId: string }) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data, isLoading } = useCommitDetail(activeRepoPath, commitId);
  const { data: avatarMap } = useCommitAvatars(activeRepoPath);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const { data: fileDiff } = useCommitFileDiff(activeRepoPath, commitId, selectedFilePath);

  if (isLoading || !data) {
    return <LoadingState label={t("history.loadingHistory")} />;
  }

  // GitHub avatar > gravatar fallback
  const authorEmail = data.commit.author.email;
  const resolvedAvatarUrl = avatarMap?.[authorEmail] ?? data.commit.author.avatarUrl;

  return (
    <CommitDetail
      commit={data.commit}
      authorAvatarUrl={resolvedAvatarUrl}
      changedFiles={data.changedFiles.map((f) => ({ path: f.path, status: f.status }))}
      selectedFileDiff={fileDiff ?? null}
      onSelectFile={setSelectedFilePath}
    />
  );
}

/**
 * 크게 보는 diff 옆에 둘 작업 중인 변경 목록. 스테이징 목록과 같은 상태 조회·선택을 쓰고,
 * 우클릭 메뉴도 스테이징 목록과 같다(`useWorkingFileMenu`).
 */
function useWorkingMaximizedFiles(): { files: MaximizedFiles; menu: ReactNode } {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: statusEntries } = useStatus(activeRepoPath);
  const selectedFile = useSelectionStore((s) => s.selectedFile);
  const selectedFileStaged = useSelectionStore((s) => s.selectedFileStaged);
  const selectFile = useSelectionStore((s) => s.selectFile);
  const fileMenu = useWorkingFileMenu(activeRepoPath);
  const items = useMemo(
    () =>
      workingFileItems(statusEntries ?? [], {
        staged: t("commit.stagedChanges"),
        unstaged: t("commit.unstaged"),
      }),
    [statusEntries, t],
  );
  return {
    files: {
      items,
      selectedKey: selectedFile === null ? null : workingFileKey(selectedFile, selectedFileStaged),
      onSelect: (key) => {
        const { path, staged } = parseWorkingFileKey(key);
        selectFile(path, staged);
      },
      onContextMenu: (key, e) => {
        const { path, staged } = parseWorkingFileKey(key);
        const entry = statusEntries?.find((s) => s.path === path && s.staged === staged);
        if (!entry) return;
        selectFile(path, staged);
        fileMenu.openMenu(entry, contextMenuPoint(e));
      },
    },
    menu: fileMenu.element,
  };
}

/* --- ContentArea (main export) --- */

interface ContentAreaProps {
  activeTab: "changes" | "history" | "stash" | "actions";
}

/**
 * The area under the graph panel. What it shows follows the row picked above:
 * - uncommitted changes row: follows that worktree (D4, `FollowPanel`); "Commit…" in its
 *   footer (or a merge/pull that stops on a conflict) shows the staging list + commit box
 * - a commit: commit detail (its own file list + diff)
 * - stash / Actions tab: the existing detail view
 * Each card carries the branch-switch overlay, so staging and committing are
 * blocked while a checkout runs (the graph panel has its own).
 */
export function ContentArea({ activeTab }: ContentAreaProps) {
  const { t } = useTranslation();

  const selectedFile = useSelectionStore((s) => s.selectedFile);
  const selectedFileStaged = useSelectionStore((s) => s.selectedFileStaged);
  const selectedCommitId = useSelectionStore((s) => s.selectedCommitId);
  const selectedStashIndex = useSelectionStore((s) => s.selectedStashIndex);
  const selectedRunId = useSelectionStore((s) => s.selectedRunId);
  const followTarget = useFollowStore((s) => s.target);
  const stopFollow = useFollowStore((s) => s.stop);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: mergeState } = useMergeState(activeRepoPath);
  const merging = mergeState !== undefined && mergeState !== null;
  const working = useWorkingMaximizedFiles();
  const activeBranch = useCachedRepoSyncStatus(activeRepoPath)?.branch ?? null;

  // 병합·pull·되돌리기 등이 충돌로 멈추면 따라가기를 끝낸다. 충돌을 푸는 배너와 스테이징
  // 목록(ChangesView)이 보여야 한다 — 그 흐름들은 「changes」 탭으로 옮기기만 하는데, 이미
  // 그 탭이면 아무것도 바뀌지 않는다.
  useEffect(() => {
    if (merging) stopFollow();
  }, [merging, stopFollow]);

  // 지금 연 워크트리가 병합 중이면 WIP 행을 다시 골라도 스테이징 목록(충돌 배너)을 먼저 보인다.
  const followingMergingRepo =
    merging && followTarget !== null && activeRepoPath !== null && trimTrailingSlash(followTarget) === trimTrailingSlash(activeRepoPath);

  // WIP 행을 고르면 그 워크트리를 따라간다(D4). 커밋은 따라가기 칸의 「커밋…」으로 스테이징 목록을 연다.
  if (activeTab === "changes" && followTarget !== null && !followingMergingRepo) {
    return (
      <FollowPanel
        key={followTarget}
        path={followTarget}
        variant="cards"
        footer={<FollowRepoFooter path={followTarget} />}
      />
    );
  }

  if (activeTab === "changes") {
    const origin: MaximizedOrigin = {
      kind: "working",
      label: (
        <>
          <span className="italic text-(--fg2) shrink-0">{t("live.uncommitted")}</span>
          {activeBranch && <RefLabel name={activeBranch} kind="local" className="max-w-[200px]" />}
        </>
      ),
      meta: t("live.fileCount", { count: working.files.items.length }),
    };
    return (
      <ListDiffSplit
        variant="cards"
        list={<ChangesView />}
        listOverlay={<SwitchingOverlay />}
        files={working.files}
        origin={origin}
        detail={
          selectedFile ? (
            <DiffContent filePath={selectedFile} staged={selectedFileStaged} />
          ) : (
            <EmptyState
              icon={FileText}
              title={t("diff.noFileSelected")}
              description={t("diff.selectFile")}
            />
          )
        }
        detailOverlay={<SwitchingOverlay />}
      >
        {working.menu}
      </ListDiffSplit>
    );
  }

  return (
    <Card className="flex-1">
      {activeTab === "actions" ? (
        selectedRunId !== null ? (
          <ActionsDetailView key={selectedRunId} runId={selectedRunId} />
        ) : (
          <EmptyState
            icon={Play}
            title={t("actions.selectRun")}
            description={t("actions.selectRun")}
          />
        )
      ) : activeTab === "stash" ? (
        selectedStashIndex !== null ? (
          <StashDetailView key={selectedStashIndex} stashIndex={selectedStashIndex} />
        ) : (
          <EmptyState
            icon={Archive}
            title={t("stash.noStashSelected")}
            description={t("stash.selectStash")}
          />
        )
      ) : selectedCommitId ? (
        <CommitDetailView key={selectedCommitId} commitId={selectedCommitId} />
      ) : (
        <EmptyState
          icon={GitCommit}
          title={t("diff.noCommitSelected")}
          description={t("shell.selectCommitOrChanges")}
        />
      )}
      <SwitchingOverlay />
    </Card>
  );
}
