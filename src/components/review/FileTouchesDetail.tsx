import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { useRangeFileDiff } from "@/api/queries";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { RepoTile, LineDelta } from "@/components/ui/marks";
import { SectionLabel } from "@/components/ui/PanelHeader";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { AvatarColor } from "@/lib/avatar-color";
import type { CommitTouch } from "@/types";
import { ticketNoteKeys, type FileTouchRow } from "./file-touches-model";

export interface FileTouchesDetailProps {
  row: FileTouchRow;
  repoLabel: (repoPath: string) => string;
  avatarColorOf: (repoPath: string) => AvatarColor;
  /** 고른 커밋. null이면 묶인 커밋 전체를 합친 변경을 본다. */
  selectedCommitOid: string | null;
  onSelectCommit: (oid: string | null) => void;
}

/**
 * 「파일별 보기」 오른쪽 칸: 파일 머리(경로, 저장소, 커밋 수, 줄 수), 이 파일을 건드린 커밋 목록,
 * 그 아래 diff. 기본은 묶인 커밋을 합친 변경이고, 커밋 하나를 고르면 그 커밋만의 변경으로
 * 바뀐다(다시 누르면 합친 변경으로 돌아온다).
 */
export const FileTouchesDetail = forwardRef<HTMLDivElement, FileTouchesDetailProps>(function FileTouchesDetail(
  { row, repoLabel, avatarColorOf, selectedCommitOid, onSelectCommit },
  ref,
) {
  const { t } = useTranslation();
  const { touches } = row;
  const activeCommit: CommitTouch | null =
    selectedCommitOid === null ? null : (touches.commits.find((c) => c.oid === selectedCommitOid) ?? null);
  const isCombined = activeCommit === null;
  // 묶인 커밋을 합쳐도 결과가 base와 같으면(넣었다 되돌림) diff를 조회하지 않는다.
  const netUnchanged = isCombined && touches.status === null;

  const baseOid = isCombined ? row.rangeBase : activeCommit.parentOid;
  const headOid = isCombined ? row.head : activeCommit.oid;
  const diffFile = netUnchanged
    ? null
    : isCombined
      ? { path: touches.path, oldPath: touches.oldPath }
      : { path: activeCommit.path, oldPath: activeCommit.oldPath };
  const diffQuery = useRangeFileDiff(row.source.path, baseOid, headOid, diffFile);

  const ticketKeys = ticketNoteKeys(touches.commits);

  let diffArea;
  if (netUnchanged) {
    diffArea = <EmptyState icon={FileText} title={t("review.fileView.netUnchanged")} />;
  } else if (diffQuery.isLoading) {
    diffArea = <LoadingState label={t("diff.loadingDiff")} />;
  } else {
    diffArea = (
      <DiffViewer
        diff={diffQuery.data ?? null}
        status={(isCombined ? touches.status : activeCommit.status) ?? "modified"}
        maximizable
        repoPath={row.source.path}
        headerExtra={
          isCombined ? (
            <span className="text-[10.5px] text-muted-foreground">
              {touches.commits.length > 0
                ? t("review.fileView.combinedScope", { count: touches.commits.length })
                : t("review.fileView.mergeOnly")}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
              <span className="font-mono">{activeCommit.shortOid}</span>
              {t("review.fileView.singleScope")}
            </span>
          )
        }
      />
    );
  }

  return (
    <div ref={ref} tabIndex={-1} data-testid="file-touches-detail" className="flex flex-col h-full min-h-0 outline-none">
      <div className="flex flex-col gap-1.5 shrink-0 px-4 pt-3.5 pb-2.5 border-b border-(--line)">
        <span title={touches.path} className="truncate font-mono text-[13px] font-bold text-foreground">
          {touches.path}
        </span>
        <div className="flex items-center gap-3 flex-wrap min-w-0 text-[11.5px] text-muted-foreground">
          <RepoTile name={repoLabel(row.source.repoPath)} color={avatarColorOf(row.source.repoPath)} size="sm" />
          {row.source.worktreeLabel && (
            <span className="font-mono" title={row.source.path}>
              {row.source.worktreeLabel}
            </span>
          )}
          <span>
            {touches.commits.length > 0
              ? t("review.fileView.commits", { count: touches.commits.length })
              : t("review.fileView.mergeOnly")}
          </span>
          {touches.status !== null && <LineDelta additions={touches.additions} deletions={touches.deletions} />}
          {ticketKeys.length > 0 && (
            <span className="font-semibold text-warning" title={ticketKeys.join(", ")}>
              {t("review.fileView.differentWork", { count: ticketKeys.length })}
            </span>
          )}
        </div>
      </div>
      {touches.commits.length > 0 && <SectionLabel title={t("review.fileView.touchedBy")} className="shrink-0" />}
      <div className="flex flex-col shrink-0 max-h-[35%] overflow-y-auto">
        {touches.commits.map((c) => {
          const selected = c.oid === selectedCommitOid;
          return (
            <button
              key={c.oid}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelectCommit(selected ? null : c.oid)}
              className={cn(
                "w-full flex items-center gap-2 h-7 px-4 text-left transition-colors motion-reduce:transition-none",
                selected ? "bg-(--acc-sel)" : "hover:bg-accent",
              )}
            >
              <RepoTile name={repoLabel(row.source.repoPath)} color={avatarColorOf(row.source.repoPath)} size="sm" />
              <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{c.shortOid}</span>
              <span className="flex-1 min-w-0 truncate text-[12.5px] text-foreground">{c.subject}</span>
              <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">{formatRelativeTime(c.authorTime)}</span>
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{diffArea}</div>
    </div>
  );
});
