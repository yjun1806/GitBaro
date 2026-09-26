import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FolderGit2, GitCommit, GitPullRequestDraft } from "lucide-react";
import { useCommitDetail, useCommitFileDiff } from "@/api/queries";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectRepo } from "@/hooks/useSelectRepo";
import { CommitDetail } from "@/components/history/CommitDetail";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";
import { RepoLaneTag } from "@/components/graph/CommitGraph";
import { FollowPanel } from "@/components/live/FollowPanel";
import { baseName } from "./review-model";
import { LoadingState } from "@/components/ui/LoadingState";

/** 리뷰 화면 아래 칸이 보여 줄 것. */
export type ReviewSelection =
  | { kind: "commit"; key: string; repoPath: string; oid: string }
  | { kind: "wip"; key: string; repoPath: string; path: string; branch: string | null; isMain: boolean }
  | null;

export interface ReviewFilesPanelProps {
  selection: ReviewSelection;
  repoLabel: (repoPath: string) => string;
  /** 목록 맨 위의 [작업 중인 변경 | 커밋] 전환(고른 저장소·워크트리 기준). */
  switcher?: ReactNode;
}

/**
 * 워크스페이스 리뷰 화면의 아래 칸: 커밋 정보 + 파일 목록 + 기존 `DiffViewer`.
 * 커밋이면 기존 커밋 상세(`CommitDetail`)를 그 저장소 경로로 부른다. WIP 행이면 그
 * 워크트리를 따라가며(D4) 커밋하지 않은 파일과 diff를 읽기 전용으로 보여 주고, 커밋하려면 저장소 화면으로 연다.
 */
export function ReviewFilesPanel({ selection, repoLabel, switcher }: ReviewFilesPanelProps) {
  const { t } = useTranslation();
  if (selection === null) {
    return (
      <EmptyState icon={GitCommit} title={t("review.selectTitle")} description={t("review.selectHint")} />
    );
  }
  if (selection.kind === "commit") {
    return (
      <ReviewCommitFiles key={selection.key} repoPath={selection.repoPath} oid={selection.oid} switcher={switcher} />
    );
  }
  return (
    <ReviewWipFiles
      key={selection.key}
      repoPath={selection.repoPath}
      path={selection.path}
      branch={selection.branch}
      isMain={selection.isMain}
      label={repoLabel(selection.repoPath)}
      switcher={switcher}
    />
  );
}

function ReviewCommitFiles({ repoPath, oid, switcher }: { repoPath: string; oid: string; switcher?: ReactNode }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useCommitDetail(repoPath, oid);
  const [filePath, setFilePath] = useState<string | null>(null);
  const { data: fileDiff } = useCommitFileDiff(repoPath, oid, filePath);

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center p-3">
        <Notice tone="danger">{t("diff.failedToLoad")}</Notice>
      </div>
    );
  }
  if (isLoading || !data) {
    return <LoadingState label={t("history.loadingHistory")} />;
  }
  return (
    <CommitDetail
      commit={data.commit}
      repoPath={repoPath}
      authorAvatarUrl={data.commit.author.avatarUrl}
      changedFiles={data.changedFiles.map((f) => ({ path: f.path, status: f.status }))}
      selectedFileDiff={fileDiff ?? null}
      onSelectFile={setFilePath}
      switcher={switcher ?? null}
    />
  );
}

interface ReviewWipFilesProps {
  repoPath: string;
  path: string;
  branch: string | null;
  isMain: boolean;
  label: string;
  switcher?: ReactNode;
}

/**
 * WIP 행: 그 워크트리를 따라간다(D4, `FollowPanel`). 읽기 전용이고, 스테이징·커밋은
 * 저장소 화면에서 한다.
 */
function ReviewWipFiles({ repoPath, path, branch, isMain, label, switcher }: ReviewWipFilesProps) {
  const { t } = useTranslation();
  const { selectRepo } = useSelectRepo();

  // 스테이징·커밋은 저장소 화면에서 한다. 워크트리면 그 워크트리로 복원되게 기억해 둔 뒤 연다.
  const handleOpen = () => {
    useRepositoryStore.getState().rememberWorktree(repoPath, isMain ? null : path);
    selectRepo(repoPath);
  };

  const header = (
    <div className="flex flex-col gap-1.5 px-3 pb-2 border-b border-(--line) shrink-0">
      <span className="flex items-center gap-1.5 min-w-0 text-[11.5px] text-muted-foreground">
        <RepoLaneTag repoPath={repoPath} label={label} />
        {!isMain && (
          <span className="inline-flex items-center gap-1 min-w-0 truncate" title={path}>
            <FolderGit2 className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="truncate font-mono">{branch ?? baseName(path)}</span>
          </span>
        )}
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleOpen}
        icon={<GitPullRequestDraft className="w-3 h-3" />}
        className="self-start mt-0.5"
      >
        {t("review.openToCommit")}
      </Button>
    </div>
  );

  return <FollowPanel path={path} variant="inline" header={header} switcher={switcher} />;
}
