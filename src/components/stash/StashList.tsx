import { useState, useId } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ArchiveRestore, PackageOpen, Trash2 } from "lucide-react";
import { StashItem } from "./StashItem";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useMenuActions } from "@/hooks/useMenuActions";
import { Dialog } from "@/components/ui/Dialog";
import { ContextMenu, contextMenuPoint, type ContextMenuSection } from "@/components/ui/ContextMenu";
import { copyMenuItem } from "@/components/ui/menu-items";

const ICON = "w-3.5 h-3.5";
import type { StashEntry } from "@/types";

interface StashListProps {
  stashes: StashEntry[];
  selectedIndex: number | null;
  onSelectStash: (index: number) => void;
  onApply: (index: number) => void;
  onPop: (index: number) => void;
  onDrop: (index: number) => void;
}

export function StashList({
  stashes,
  selectedIndex,
  onSelectStash,
  onApply,
  onPop,
  onDrop,
}: StashListProps) {
  const { t } = useTranslation();

  const selectedStashIdx = stashes.findIndex((s) => s.index === selectedIndex);

  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: stashes,
    onSelect: (e) => onSelectStash(e.index),
    selectedIndex: selectedStashIdx,
  });

  // 스태시는 커밋 id로 가리킨다. 메뉴를 연 사이 목록이 바뀌면(다른 곳에서 push·drop) 번호가 밀린다.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    commitId: string;
  } | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);
  // 가리키던 스태시가 목록에서 사라지면 메뉴와 확인 창을 그리지 않는다.
  const menuEntry = contextMenu ? stashes.find((s) => s.commitId === contextMenu.commitId) : undefined;
  const dropEntry = confirmDrop !== null ? stashes.find((s) => s.commitId === confirmDrop) : undefined;
  const dropTitleId = useId();

  if (stashes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 py-12">
        <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
          <Archive className="w-6 h-6" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">{t("stash.noStashes")}</p>
          <p className="text-xs mt-1">{t("stash.noStashesDescription")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto" {...containerProps}>
      {stashes.map((entry, index) => (
        <StashItem
          key={entry.index}
          ref={itemRef(index)}
          entry={entry}
          isSelected={selectedIndex === entry.index}
          isHighlighted={activeIndex === index}
          onClick={() => onSelectStash(entry.index)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ ...contextMenuPoint(e), commitId: entry.commitId });
          }}
        />
      ))}

      {/* Context Menu */}
      {contextMenu && menuEntry && (
        <StashContextMenu
          entry={menuEntry}
          position={contextMenu}
          onApply={() => onApply(menuEntry.index)}
          onPop={() => onPop(menuEntry.index)}
          onDrop={() => setConfirmDrop(menuEntry.commitId)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Drop Confirmation Dialog */}
      {dropEntry && (
        <Dialog
          onClose={() => setConfirmDrop(null)}
          labelledBy={dropTitleId}
          overlayClassName="z-50 bg-black/50"
          className="bg-popover border border-border rounded-xl shadow-2xl p-6 w-[360px]"
        >
            <h3 id={dropTitleId} className="text-sm font-semibold">{t("stash.dropConfirm")}</h3>
            <p className="text-xs text-muted-foreground mt-2">
              {t("stash.dropConfirmDescription")}
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                className="px-3 py-1.5 text-xs rounded-md hover:bg-accent transition-colors"
                onClick={() => setConfirmDrop(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="px-3 py-1.5 text-xs rounded-md bg-danger text-danger-foreground hover:bg-danger/90 transition-colors"
                onClick={() => {
                  onDrop(dropEntry.index);
                  setConfirmDrop(null);
                }}
              >
                {t("stash.drop")}
              </button>
            </div>
        </Dialog>
      )}
    </div>
  );
}

interface StashContextMenuProps {
  entry: StashEntry;
  position: { x: number; y: number };
  onApply: () => void;
  onPop: () => void;
  onDrop: () => void;
  onClose: () => void;
}

/** 스태시 항목 우클릭 메뉴: 적용·꺼내기, 메시지·SHA 복사, 맨 아래에 삭제(확인 창). */
function StashContextMenu({ entry, position, onApply, onPop, onDrop, onClose }: StashContextMenuProps) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const sections: ContextMenuSection[] = [
    {
      items: [
        { label: t("stash.apply"), icon: <ArchiveRestore className={ICON} />, onClick: onApply },
        { label: t("stash.pop"), icon: <PackageOpen className={ICON} />, onClick: onPop },
      ],
    },
    {
      items: [
        copyMenuItem(t("menu.copyStashMessage"), entry.message, actions),
        copyMenuItem(t("history.contextMenu.copyHash"), entry.commitId, actions),
      ],
    },
    {
      items: [{ label: t("stash.drop"), icon: <Trash2 className={ICON} />, variant: "danger", onClick: onDrop }],
    },
  ];
  return <ContextMenu sections={sections} position={position} onClose={onClose} ariaLabel={t("menu.stashMenu")} />;
}
