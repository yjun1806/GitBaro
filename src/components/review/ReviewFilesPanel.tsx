import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, FolderGit2, GitCommit, GitPullRequestDraft } from "lucide-react";
import { useCommitDetail, useCommitFileDiff, useFileDiff } from "@/api/queries";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectRepo } from "@/hooks/useSelectRepo";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { FileStatusBadge } from "@/lib/file-status";
import { cn } from "@/lib/utils";
import { CommitDetail } from "@/components/history/CommitDetail";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { EmptyState } from "@/components/layout/ContentArea";
import { RepoLaneTag } from "@/components/graph/CommitGraph";
import type { StatusEntry } from "@/types";
import { baseName } from "./review-model";

/** 리뷰 화면 아래 칸이 보여 줄 것. */
export type ReviewSelection =
  | { kind: "commit"; key: string; repoPath: string; oid: string }
  | { kind: "wip"; key: string; repoPath: string; path: string; branch: string | null; isMain: boolean }
  | null;

export interface ReviewFilesPanelProps {
  selection: ReviewSelection;
  repoLabel: (repoPath: string) => string;
  /** 워크트리 경로 → 커밋하지 않은 변경(그래프와 같은 조회 결과). */
  statuses: Record<string, StatusEntry[]>;
}

/**
 * 워크스페이스 리뷰 화면의 아래 칸: 커밋 정보 + 파일 목록 + 기존 `DiffViewer`.
 * 커밋이면 기존 커밋 상세(`CommitDetail`)를 그 저장소 경로로 부른다. WIP 행이면 그
 * 워크트리의 커밋하지 않은 파일과 diff를 읽기 전용으로 보여 주고, 커밋하려면 저장소 화면으로 연다.
 */
export function ReviewFilesPanel({ selection, repoLabel, statuses }: ReviewFilesPanelProps) {
  const { t } = useTranslation();
  if (selection === null) {
    return (
      <EmptyState icon={GitCommit} title={t("review.selectTitle")} description={t("review.selectHint")} />
    );
  }
  if (selection.kind === "commit") {
    return <ReviewCommitFiles key={selection.key} repoPath={selection.repoPath} oid={selection.oid} />;
  }
  return (
    <ReviewWipFiles
      key={selection.key}
      repoPath={selection.repoPath}
      path={selection.path}
      branch={selection.branch}
      isMain={selection.isMain}
      label={repoLabel(selection.repoPath)}
      entries={statuses[selection.path]}
    />
  );
}

function ReviewCommitFiles({ repoPath, oid }: { repoPath: string; oid: string }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useCommitDetail(repoPath, oid);
  const [filePath, setFilePath] = useState<string | null>(null);
  const { data: fileDiff } = useCommitFileDiff(repoPath, oid, filePath);

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-danger">{t("diff.failedToLoad")}</div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("history.loadingHistory")}
      </div>
    );
  }
  return (
    <CommitDetail
      commit={data.commit}
      repoPath={repoPath}
      authorAvatarUrl={data.commit.author.avatarUrl}
      changedFiles={data.changedFiles.map((f) => ({ path: f.path, status: f.status }))}
      selectedFileDiff={fileDiff ?? null}
      onSelectFile={setFilePath}
    />
  );
}

interface ReviewWipFilesProps {
  repoPath: string;
  path: string;
  branch: string | null;
  isMain: boolean;
  label: string;
  entries: StatusEntry[] | undefined;
}

function ReviewWipFiles({ repoPath, path, branch, isMain, label, entries }: ReviewWipFilesProps) {
  const { t } = useTranslation();
  const { selectRepo } = useSelectRepo();
  const files = entries ?? [];
  const [picked, setPicked] = useState<{ path: string; staged: boolean } | null>(null);
  const current = picked ?? (files[0] ? { path: files[0].path, staged: files[0].staged } : null);
  const { data: diff, isLoading, isError } = useFileDiff(path, current?.path ?? null, current?.staged ?? false);
  const selectedIndex = current
    ? files.findIndex((f) => f.path === current.path && f.staged === current.staged)
    : -1;
  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: files,
    onSelect: (f) => setPicked({ path: f.path, staged: f.staged }),
    selectedIndex,
  });

  // 스테이징·커밋은 저장소 화면에서 한다. 워크트리면 그 워크트리로 복원되게 기억해 둔 뒤 연다.
  const handleOpen = () => {
    useRepositoryStore.getState().rememberWorktree(repoPath, isMain ? null : path);
    selectRepo(repoPath);
  };

  const status = files.find((f) => f.path === current?.path && f.staged === current?.staged)?.status;

  return (
    <div className="flex h-full min-h-0">
      <div className="w-[300px] shrink-0 flex flex-col min-h-0 border-r border-(--line)">
        <div className="flex flex-col gap-1.5 px-3 py-3 border-b border-(--line) shrink-0">
          <strong className="text-[13px] font-bold text-foreground leading-[18px] italic">
            {t("shell.uncommitted")}
          </strong>
          <span className="flex items-center gap-1.5 min-w-0 text-[11.5px] text-muted-foreground">
            <RepoLaneTag repoPath={repoPath} label={label} />
            {!isMain && (
              <span className="inline-flex items-center gap-1 min-w-0 truncate" title={path}>
                <FolderGit2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="truncate font-mono">{branch ?? baseName(path)}</span>
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={handleOpen}
            className="self-start flex items-center gap-1.5 h-6 mt-0.5 px-2.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent transition-colors"
          >
            <GitPullRequestDraft className="w-3 h-3" aria-hidden="true" />
            {t("review.openToCommit")}
          </button>
        </div>
        <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-(--faint) shrink-0">
          {t("commitDetail2.changedFiles", { count: files.length })}
        </div>
        <div className="flex-1 overflow-y-auto" {...containerProps}>
          {entries === undefined ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t("diff.loadingDiff")}</p>
          ) : files.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t("review.noChanges")}</p>
          ) : (
            files.map((f, index) => {
              const selected = index === selectedIndex;
              return (
                <button
                  key={`${f.staged ? "s" : "u"}:${f.path}`}
                  ref={itemRef(index)}
                  type="button"
                  title={f.path}
                  onClick={() => setPicked({ path: f.path, staged: f.staged })}
                  className={cn(
                    "w-full flex items-center gap-2 h-(--row) px-3 text-left border-b border-(--line) transition-colors",
                    selected
                      ? "bg-(--acc-sel)"
                      : activeIndex === index
                        ? "bg-accent ring-1 ring-inset ring-primary/30"
                        : "hover:bg-accent",
                  )}
                >
                  <FileStatusBadge status={f.status} />
                  <span className="flex-1 min-w-0 truncate text-[12.5px] text-foreground">{baseName(f.path)}</span>
                  {f.staged && (
                    <span className="shrink-0 text-[10.5px] text-(--faint)">{t("review.staged")}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {current === null ? (
          <EmptyState icon={FileText} title={t("diff.noFileSelected")} description={t("diff.selectFile")} />
        ) : isError ? (
          <div className="flex-1 flex items-center justify-center text-sm text-danger">{t("diff.failedToLoad")}</div>
        ) : isLoading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {t("diff.loadingDiff")}
          </div>
        ) : (
          <DiffViewer diff={diff ?? null} status={status ?? "modified"} staged={current.staged} />
        )}
      </div>
    </div>
  );
}
