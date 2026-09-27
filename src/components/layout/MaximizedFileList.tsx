import { useTranslation } from "react-i18next";
import { PanelLeftOpen } from "lucide-react";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { cn } from "@/lib/utils";
import { MAXIMIZED_LIST_FOLDED_WIDTH, MAXIMIZED_LIST_WIDTH } from "@/lib/split-size";
import { FileStatusLetter, LineDelta } from "@/components/ui/marks";
import { SectionLabel } from "@/components/ui/PanelHeader";
import { splitFilePath, type MaximizedFiles } from "./maximized-files";

/**
 * 크게 보는 diff 왼쪽의 좁은 파일 목록(5.4, 폭 260px). diff를 연 목록의 행과 선택을 그대로 보여 주고,
 * 누르거나 위아래 화살표로 옮기면 원래 목록에서 고른 것과 같다. 「목록 접기」(`DiffHeader`)를 누르면
 * 이 목록 대신 {@link MaximizedFileListBand}가 뜬다.
 */
export function MaximizedFileList({ items, selectedKey, onSelect, onContextMenu, onDoubleClick }: MaximizedFiles) {
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
      className="flex flex-col shrink-0 min-h-0 border-r border-(--line) bg-card"
      style={{ width: MAXIMIZED_LIST_WIDTH }}
    >
      <SectionLabel title={t("diff.fileListCount", { count: items.length })} className="border-b border-(--line)" />
      <div className="flex-1 min-h-0 overflow-y-auto" {...containerProps}>
        {items.map((f, index) => {
          const { dir, name } = splitFilePath(f.path);
          const selected = f.key === selectedKey;
          const groupStart = f.group !== undefined && f.group !== items[index - 1]?.group;
          return (
            <div key={f.key}>
              {groupStart && <SectionLabel title={f.group ?? ""} />}
              <button
                ref={itemRef(index)}
                type="button"
                title={f.path}
                aria-current={selected || undefined}
                onClick={() => onSelect(f.key)}
                onDoubleClick={onDoubleClick ? () => onDoubleClick(f.key) : undefined}
                onContextMenu={
                  onContextMenu
                    ? (e) => {
                        e.preventDefault();
                        onContextMenu(f.key, e);
                      }
                    : undefined
                }
                className={cn(
                  "w-full flex items-center gap-1.5 h-7 px-3 text-left select-none transition-colors motion-reduce:transition-none",
                  selected
                    ? "bg-(--acc-sel)"
                    : activeIndex === index
                      ? "bg-accent ring-1 ring-inset ring-primary/30"
                      : "hover:bg-accent",
                )}
              >
                <span className="flex flex-1 min-w-0 items-center gap-1.5">
                  <FileStatusLetter status={f.status} />
                  <span className="flex-1 min-w-0 truncate text-[12.5px] text-foreground">
                    {name}
                    {dir && <span className="ml-1 text-[11.5px] text-muted-foreground">{dir}</span>}
                  </span>
                  <LineDelta additions={f.additions} deletions={f.deletions} className="text-[11.5px]" />
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export interface MaximizedFileListBandProps {
  /** 목록에 파일이 몇 개인지(칩 대신 세로 글자로 보인다). */
  count: number;
  onExpand: () => void;
}

/**
 * {@link MaximizedFileList}를 「목록 접기」로 접었을 때 diff 옆에 남는 36px 띠(5.4). 누르면 다시
 * 펼친다. 크게 보기를 벗어나면(`ListDiffSplit`) 접힘이 풀려 다음에 다시 크게 볼 때는 펼친 채 시작한다.
 */
export function MaximizedFileListBand({ count, onExpand }: MaximizedFileListBandProps) {
  const { t } = useTranslation();
  return (
    // 접힌 목록을 펴는 것과 `DiffHeader`의 "Show file list" 버튼(같은 뜻)이 함께 보이므로 접근성
    // 이름이 겹치지 않게 aria-label을 따로 두지 않는다 — 세로 글자(파일 수)가 그대로 이름이 된다.
    <button
      type="button"
      onClick={onExpand}
      title={t("diff.showFileList")}
      data-testid="maximized-file-list-band"
      style={{ width: MAXIMIZED_LIST_FOLDED_WIDTH }}
      className="flex flex-col items-center justify-center gap-1.5 shrink-0 h-full border-r border-(--line) bg-card hover:bg-accent transition-colors motion-reduce:transition-none"
    >
      <PanelLeftOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
      <span className="[writing-mode:vertical-rl] text-[10.5px] font-semibold text-muted-foreground tabular-nums">
        {t("diff.fileListCount", { count })}
      </span>
    </button>
  );
}
