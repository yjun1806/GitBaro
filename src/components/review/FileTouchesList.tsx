import type { KeyboardEvent, CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { splitFilePath } from "@/components/layout/maximized-files";
import { FileStatusLetter, RepoTile } from "@/components/ui/marks";
import { SectionLabel } from "@/components/ui/PanelHeader";
import type { AvatarColor } from "@/lib/avatar-color";
import { ticketNoteKeys, type FileTouchRepoError, type FileTouchRow } from "./file-touches-model";

export interface FileTouchesListProps {
  multi: readonly FileTouchRow[];
  single: readonly FileTouchRow[];
  errors: readonly FileTouchRepoError[];
  truncatedRepos: readonly string[];
  selectedKey: string | null;
  activeIndex: number;
  repoLabel: (repoPath: string) => string;
  avatarColorOf: (repoPath: string) => AvatarColor;
  onSelect: (row: FileTouchRow, index: number) => void;
  containerProps: { tabIndex: number; onKeyDown: (e: KeyboardEvent) => void; style: CSSProperties };
  itemRef: (index: number) => (el: HTMLElement | null) => void;
}

/**
 * 「파일별 보기」 왼쪽 목록: 커밋 여러 개가 건드린 파일을 먼저, 그다음 커밋 하나만 건드린 파일을
 * 보인다(순서는 `groupFileTouches`가 정한다). 읽지 못한 저장소는 위에 따로 알린다.
 */
export function FileTouchesList({
  multi,
  single,
  errors,
  truncatedRepos,
  selectedKey,
  activeIndex,
  repoLabel,
  avatarColorOf,
  onSelect,
  containerProps,
  itemRef,
}: FileTouchesListProps) {
  const { t } = useTranslation();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" role="listbox" aria-label={t("review.fileView.segFiles")} {...containerProps}>
      {errors.map((e) => (
        <div key={e.repoPath} className="flex items-start gap-1.5 px-3 py-2 text-[11.5px] text-danger" role="alert">
          <AlertTriangle className="w-3 h-3 mt-px shrink-0" aria-hidden="true" />
          <span className="min-w-0">{t("review.repoError", { repo: repoLabel(e.repoPath), error: e.error })}</span>
        </div>
      ))}
      {truncatedRepos.map((repoPath) => (
        <p key={repoPath} className="px-3 py-1.5 text-[11.5px] text-muted-foreground">
          {t("review.fileView.repoTruncated", { repo: repoLabel(repoPath) })}
        </p>
      ))}
      {multi.length > 0 && <SectionLabel title={t("review.fileView.groupMulti")} />}
      {multi.map((row, i) => (
        <FileTouchesRow
          key={row.key}
          row={row}
          index={i}
          selected={row.key === selectedKey}
          highlighted={i === activeIndex}
          repoLabel={repoLabel}
          avatarColorOf={avatarColorOf}
          onSelect={onSelect}
          itemRef={itemRef}
        />
      ))}
      {single.length > 0 && <SectionLabel title={t("review.fileView.groupSingle")} />}
      {single.map((row, i) => {
        const index = multi.length + i;
        return (
          <FileTouchesRow
            key={row.key}
            row={row}
            index={index}
            selected={row.key === selectedKey}
            highlighted={index === activeIndex}
            repoLabel={repoLabel}
            avatarColorOf={avatarColorOf}
            onSelect={onSelect}
            itemRef={itemRef}
          />
        );
      })}
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
  itemRef,
}: {
  row: FileTouchRow;
  index: number;
  selected: boolean;
  highlighted: boolean;
  repoLabel: (repoPath: string) => string;
  avatarColorOf: (repoPath: string) => AvatarColor;
  onSelect: (row: FileTouchRow, index: number) => void;
  itemRef: (index: number) => (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const { touches } = row;
  const { dir, name } = splitFilePath(touches.path);
  const ticketKeys = ticketNoteKeys(touches.commits);
  const newestAt = touches.commits[0]?.authorTime;

  return (
    <button
      ref={itemRef(index)}
      type="button"
      role="option"
      aria-selected={selected}
      title={touches.oldPath ? `${touches.oldPath} → ${touches.path}` : touches.path}
      onClick={() => onSelect(row, index)}
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
        {newestAt != null && (
          <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">{formatRelativeTime(newestAt)}</span>
        )}
      </span>
      <span className="flex items-center gap-1.5 min-w-0 pl-[18px] text-[11.5px] text-muted-foreground">
        <RepoTile name={repoLabel(row.repoPath)} color={avatarColorOf(row.repoPath)} size="sm" />
        <span className="shrink-0">{t("review.fileView.commits", { count: touches.commits.length })}</span>
        {touches.status !== null && (
          <span className="shrink-0 font-mono">
            <span className="text-diff-add-fg">+{touches.additions}</span> <span className="text-diff-del-fg">−{touches.deletions}</span>
          </span>
        )}
        {ticketKeys.length > 0 && (
          <span className="min-w-0 truncate font-semibold text-warning" title={ticketKeys.join(", ")}>
            {t("review.fileView.ticketNote", { keys: ticketKeys.join(", ") })}
          </span>
        )}
      </span>
    </button>
  );
}
