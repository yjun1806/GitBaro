import { useState, useRef, useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { Archive } from "lucide-react";
import { StashItem } from "./StashItem";
import { cn } from "@/lib/utils";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useMenuKeyboard } from "@/hooks/useMenuKeyboard";
import { Dialog } from "@/components/ui/Dialog";
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
            setContextMenu({ x: e.clientX, y: e.clientY, index: entry.index });
          }}
        />
      ))}

      {/* Context Menu */}
      {contextMenu && (
        <StashContextMenu
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
  position: { x: number; y: number };
  onApply: () => void;
  onPop: () => void;
  onDrop: () => void;
  onClose: () => void;
}

function StashContextMenu({ position, onApply, onPop, onDrop, onClose }: StashContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const { onKeyDown, restoreFocus } = useMenuKeyboard(menuRef, onClose);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const run = (action: () => void) => () => {
    restoreFocus();
    action();
    onClose();
  };

  const itemClass = "w-full px-3 py-1.5 text-xs text-left transition-colors outline-none";

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed z-50 min-w-[160px] bg-popover border border-border rounded-lg shadow-lg py-1 outline-none"
      style={{ left: position.x, top: position.y }}
    >
      <button role="menuitem" className={cn(itemClass, "hover:bg-accent focus-visible:bg-accent")} onClick={run(onApply)}>
        {t("stash.apply")}
      </button>
      <button role="menuitem" className={cn(itemClass, "hover:bg-accent focus-visible:bg-accent")} onClick={run(onPop)}>
        {t("stash.pop")}
      </button>
      <div role="separator" className="border-t border-border my-1" />
      <button
        role="menuitem"
        className={cn(itemClass, "text-danger hover:bg-danger/10 focus-visible:bg-danger/10")}
        onClick={run(onDrop)}
      >
        {t("stash.drop")}
      </button>
    </div>
  );
}
