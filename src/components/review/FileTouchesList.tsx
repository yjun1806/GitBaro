import type { KeyboardEvent, CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { splitFilePath } from "@/components/layout/maximized-files";
import { FileStatusLetter, RepoTile, LineDelta } from "@/components/ui/marks";
import { SectionLabel } from "@/components/ui/PanelHeader";
import type { AvatarColor } from "@/lib/avatar-color";
import {
  latestTouchTime,
  ticketNoteKeys,
  type FileTouchRow,
  type FileTouchSource,
  type GroupedFileTouches,
} from "./file-touches-model";

export interface FileTouchesListProps {
  grouped: GroupedFileTouches;
  selectedKey: string | null;
  activeIndex: number;
  repoLabel: (repoPath: string) => string;
  avatarColorOf: (repoPath: string) => AvatarColor;
  onSelect: (row: FileTouchRow, index: number) => void;
  onDoubleClick: (row: FileTouchRow) => void;
  containerProps: { tabIndex: number; onKeyDown: (e: KeyboardEvent) => void; style: CSSProperties };
  itemRef: (index: number) => (el: HTMLElement | null) => void;
}

/** 알림 줄에 쓰는 워크트리 이름: 저장소 이름, 메인 작업 트리가 아니면 워크트리 이름을 덧붙인다. */
function fileTouchSourceName(t: TFunction, repoLabel: (repoPath: string) => string, source: FileTouchSource): string {
  const repo = repoLabel(source.repoPath);
  return source.worktreeLabel ? t("review.fileView.worktreeSource", { repo, worktree: source.worktreeLabel }) : repo;
}

/**
 * 「파일별 보기」 왼쪽 목록: 커밋 여러 개가 건드린 파일, 커밋 하나만 건드린 파일, 병합에서만 바뀐 파일 순으로
 * 보인다(순서는 `groupFileTouches`가 정한다). 읽는 중이거나 읽지 못한 워크트리는 위에 한 줄씩 알린다.
 */
export function FileTouchesList({
  grouped,
  selectedKey,
  activeIndex,
  repoLabel,
  avatarColorOf,
  onSelect,
  onDoubleClick,
  containerProps,
  itemRef,
}: FileTouchesListProps) {
  const { t } = useTranslation();
  const { multi, single, mergeOnly, pending, errors, truncated, merges } = grouped;
  const nameOf = (source: FileTouchSource) => fileTouchSourceName(t, repoLabel, source);
  const sections = [
    { title: t("review.fileView.groupMulti"), rows: multi, offset: 0 },
    { title: t("review.fileView.groupSingle"), rows: single, offset: multi.length },
    { title: t("review.fileView.groupMergeOnly"), rows: mergeOnly, offset: multi.length + single.length },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" role="listbox" aria-label={t("review.fileView.segFiles")} {...containerProps}>
      {errors.map((e) => (
        <div key={e.source.path} className="flex items-start gap-1.5 px-3 py-2 text-[11.5px] text-danger" role="alert">
          <AlertTriangle className="w-3 h-3 mt-px shrink-0" aria-hidden="true" />
          <span className="min-w-0">{t("review.repoError", { repo: nameOf(e.source), error: e.error })}</span>
        </div>
      ))}
      {pending.map((source) => (
        <p key={source.path} className="px-3 py-1.5 text-[11.5px] text-muted-foreground" role="status">
          {t("review.fileView.sourceLoading", { repo: nameOf(source) })}
        </p>
      ))}
      {truncated.map((source) => (
        <p key={source.path} className="px-3 py-1.5 text-[11.5px] text-muted-foreground">
          {t("review.fileView.repoTruncated", { repo: nameOf(source) })}
        </p>
      ))}
      {merges.map(({ source, count }) => (
        <p key={source.path} className="px-3 py-1.5 text-[11.5px] text-muted-foreground">
          {t("review.fileView.mergesLeftOut", { repo: nameOf(source), count })}
        </p>
      ))}
      {sections.map(
        ({ title, rows, offset }) =>
          rows.length > 0 && [
            <SectionLabel key={title} title={title} />,
            ...rows.map((row, i) => (
              <FileTouchesRow
                key={row.key}
                row={row}
                index={offset + i}
                selected={row.key === selectedKey}
                highlighted={offset + i === activeIndex}
                repoLabel={repoLabel}
                avatarColorOf={avatarColorOf}
                onSelect={onSelect}
                onDoubleClick={onDoubleClick}
                itemRef={itemRef}
              />
            )),
          ],
      )}
    </div>
  );
}

function FileTouchesRow({
  row,
  index,
  selected,
  highlighted,
  repoLabel,
  avatarColorOf,
  onSelect,
  onDoubleClick,
  itemRef,
}: {
  row: FileTouchRow;
  index: number;
  selected: boolean;
  highlighted: boolean;
  repoLabel: (repoPath: string) => string;
  avatarColorOf: (repoPath: string) => AvatarColor;
  onSelect: (row: FileTouchRow, index: number) => void;
  onDoubleClick: (row: FileTouchRow) => void;
  itemRef: (index: number) => (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const { touches } = row;
  const { dir, name } = splitFilePath(touches.path);
  const ticketKeys = ticketNoteKeys(touches.commits);
  const latestAt = touches.commits.length > 0 ? latestTouchTime(touches) : null;

  return (
    <button
      ref={itemRef(index)}
      type="button"
      role="option"
      aria-selected={selected}
      title={touches.oldPath ? `${touches.oldPath} → ${touches.path}` : touches.path}
      onClick={() => onSelect(row, index)}
      onDoubleClick={() => onDoubleClick(row)}
      className={cn(
        "w-full flex flex-col justify-center gap-1 min-h-11 px-3 py-1.5 text-left border-b border-(--line) select-none transition-colors motion-reduce:transition-none",
        selected ? "bg-(--acc-sel)" : highlighted ? "bg-accent ring-1 ring-inset ring-primary/30" : "hover:bg-accent",
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        {touches.status ? (
          <FileStatusLetter status={touches.status} />
        ) : (
          <span className="w-2.5 shrink-0" aria-hidden="true" />
        )}
        <span className={cn("flex-1 min-w-0 truncate font-mono text-[12.5px] text-foreground", selected && "font-semibold")}>
          {name}
          {dir && <span className="ml-1 text-[11.5px] text-muted-foreground">{dir}</span>}
        </span>
        {latestAt !== null && (
          <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">{formatRelativeTime(latestAt)}</span>
        )}
      </span>
      <span className="flex items-center gap-1.5 min-w-0 pl-[18px] text-[11.5px] text-muted-foreground">
        <RepoTile name={repoLabel(row.source.repoPath)} color={avatarColorOf(row.source.repoPath)} size="sm" />
        {row.source.worktreeLabel && (
          <span className="min-w-0 truncate font-mono" title={row.source.path}>
            {row.source.worktreeLabel}
          </span>
        )}
        <span className="shrink-0">
          {touches.commits.length > 0
            ? t("review.fileView.commits", { count: touches.commits.length })
            : t("review.fileView.mergeOnly")}
        </span>
        {touches.status !== null && <LineDelta additions={touches.additions} deletions={touches.deletions} />}
        {ticketKeys.length > 0 && (
          <span className="min-w-0 truncate font-semibold text-warning" title={ticketKeys.join(", ")}>
            {t("review.fileView.ticketNote", { keys: ticketKeys.join(", ") })}
          </span>
        )}
      </span>
    </button>
  );
}
