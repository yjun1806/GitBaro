import { useTranslation } from "react-i18next";
import { FileStatusBadge } from "@/lib/file-status";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { cn } from "@/lib/utils";
import { splitFilePath, type MaximizedFiles } from "./maximized-files";

/**
 * 크게 보는 diff 왼쪽의 좁은 파일 목록. diff를 연 목록의 행과 선택을 그대로 보여 주고,
 * 누르거나 위아래 화살표로 옮기면 원래 목록에서 고른 것과 같다.
 */
export function MaximizedFileList({ items, selectedKey, onSelect, onContextMenu }: MaximizedFiles) {
  const { t } = useTranslation();
  const selectedIndex = selectedKey === null ? -1 : items.findIndex((f) => f.key === selectedKey);
  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items,
    onSelect: (f) => onSelect(f.key),
    selectedIndex,
  });

  return (
    <nav
      aria-label={t("diff.fileList")}
      data-testid="maximized-file-list"
      className="flex flex-col w-[220px] shrink-0 min-h-0 border-r border-(--line) bg-card"
    >
      <div className="flex items-center gap-1.5 h-[36px] px-3 shrink-0 border-b border-(--line) text-[11px] font-semibold text-(--faint)">
        {t("diff.fileListCount", { count: items.length })}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto" {...containerProps}>
        {items.map((f, index) => {
          const { dir, name } = splitFilePath(f.path);
          const selected = f.key === selectedKey;
          const groupStart = f.group !== undefined && f.group !== items[index - 1]?.group;
          return (
            <div key={f.key}>
              {groupStart && (
                <div className="px-3 pt-2 pb-0.5 text-[10.5px] font-semibold text-(--faint) truncate">{f.group}</div>
              )}
              <button
                ref={itemRef(index)}
                type="button"
                title={f.path}
                aria-current={selected || undefined}
                onClick={() => onSelect(f.key)}
                onContextMenu={
                  onContextMenu
                    ? (e) => {
                        e.preventDefault();
                        onContextMenu(f.key, e);
                      }
                    : undefined
                }
                className={cn(
                  "w-full flex items-center gap-1.5 h-7 px-3 text-left transition-colors",
                  selected
                    ? "bg-(--acc-sel)"
                    : activeIndex === index
                      ? "bg-accent ring-1 ring-inset ring-primary/30"
                      : "hover:bg-accent",
                )}
              >
                <span className="flex flex-1 min-w-0 items-center gap-1.5">
                  <FileStatusBadge status={f.status} />
                  <span className="flex-1 min-w-0 truncate text-[12px] text-foreground">
                    {name}
                    {dir && <span className="ml-1 text-[10.5px] text-(--faint)">{dir}</span>}
                  </span>
                  {f.additions != null && f.additions > 0 && (
                    <span className="shrink-0 font-mono text-[10.5px] text-diff-add-fg">+{f.additions}</span>
                  )}
                  {f.deletions != null && f.deletions > 0 && (
                    <span className="shrink-0 font-mono text-[10.5px] text-diff-del-fg">−{f.deletions}</span>
                  )}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
