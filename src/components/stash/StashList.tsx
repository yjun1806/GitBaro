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

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    index: number;
  } | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<number | null>(null);
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
            setContextMenu({ ...contextMenuPoint(e), index: entry.index });
          }}
        />
      ))}

      {/* Context Menu */}
      {contextMenu && (
        <StashContextMenu
          entry={stashes.find((s) => s.index === contextMenu.index) ?? stashes[0]}
          position={contextMenu}
          onApply={() => onApply(contextMenu.index)}
          onPop={() => onPop(contextMenu.index)}
          onDrop={() => setConfirmDrop(contextMenu.index)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Drop Confirmation Dialog */}
      {confirmDrop !== null && (
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
                  onDrop(confirmDrop);
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
