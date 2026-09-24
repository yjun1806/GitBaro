import { useEffect, useState, type ReactNode } from "react";
import { FileText, GitCommit, GitCompare, Archive, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import {
  useStatus,
  useFileDiff,
  useCommitDetail,
  useCommitFileDiff,
  useCommitAvatars,
  useMergeState,
} from "@/api/queries";
import { cn } from "@/lib/utils";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { CommitDetail } from "@/components/history/CommitDetail";
import { StashDetailView } from "@/components/stash/StashDetailView";
import { ActionsDetailView } from "@/components/actions/ActionsDetailView";
import { ChangesView } from "@/components/commit/ChangesView";
import { SwitchingOverlay } from "@/components/ui/SwitchingOverlay";
import { FollowPanel, FollowRepoFooter } from "@/components/live/FollowPanel";
import { useFollowStore } from "@/stores/follow";
import { normalizePath } from "@/components/graph/graph-model";
import type { FileStatus } from "@/types";

/* --- Empty / Placeholder States --- */

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
      <div className="w-16 h-16 rounded-full bg-surface flex items-center justify-center">
        <Icon className="w-8 h-8" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs mt-1">{description}</p>
      </div>
    </div>
  );
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
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("diff.loadingDiff")}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-danger">
        {t("diff.failedToLoad")}
      </div>
    );
  }

  return <DiffViewer diff={diff ?? null} status={fileStatus} staged={staged} />;
}

function CommitDetailView({ commitId }: { commitId: string }) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data, isLoading } = useCommitDetail(activeRepoPath, commitId);
  const { data: avatarMap } = useCommitAvatars(activeRepoPath);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const { data: fileDiff } = useCommitFileDiff(activeRepoPath, commitId, selectedFilePath);

  if (isLoading || !data) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("history.loadingHistory")}
      </div>
    );
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

/* --- Card --- */

/** A panel card from the design: panel colour, 14px corners, panel shadow. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "relative flex flex-col min-w-0 min-h-0 bg-card rounded-(--radius-panel) shadow-(--shadow) overflow-hidden",
        className,
      )}
    >
      {children}
    </section>
  );
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
  const compareBranch = useUIStore((s) => s.compareBranch);

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

  // 병합·pull·되돌리기 등이 충돌로 멈추면 따라가기를 끝낸다. 충돌을 푸는 배너와 스테이징
  // 목록(ChangesView)이 보여야 한다 — 그 흐름들은 「changes」 탭으로 옮기기만 하는데, 이미
  // 그 탭이면 아무것도 바뀌지 않는다.
  useEffect(() => {
    if (merging) stopFollow();
  }, [merging, stopFollow]);

  // 지금 연 워크트리가 병합 중이면 WIP 행을 다시 골라도 스테이징 목록(충돌 배너)을 먼저 보인다.
  const followingMergingRepo =
    merging && followTarget !== null && activeRepoPath !== null && normalizePath(followTarget) === normalizePath(activeRepoPath);

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
    return (
      <div className="flex flex-1 min-h-0 gap-(--g)">
        <Card className="w-[320px] shrink-0">
          <ChangesView />
          <SwitchingOverlay />
        </Card>
        <Card className="flex-1">
          {selectedFile ? (
            <DiffContent filePath={selectedFile} staged={selectedFileStaged} />
          ) : (
            <EmptyState
              icon={FileText}
              title={t("diff.noFileSelected")}
              description={t("diff.selectFile")}
            />
          )}
          <SwitchingOverlay />
        </Card>
      </div>
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
      ) : compareBranch ? (
        <EmptyState
          icon={GitCompare}
          title={t("diff.noCommitSelected")}
          description={t("compare.comparingWith", { branch: compareBranch })}
        />
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
