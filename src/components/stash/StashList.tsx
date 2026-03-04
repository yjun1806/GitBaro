import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Archive } from "lucide-react";
import { StashItem } from "./StashItem";
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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    index: number;
  } | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [contextMenu]);

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
    <div className="flex-1 overflow-y-auto">
      {stashes.map((entry) => (
        <StashItem
          key={entry.index}
          entry={entry}
          isSelected={selectedIndex === entry.index}
          onClick={() => onSelectStash(entry.index)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, index: entry.index });
          }}
        />
      ))}

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[160px] bg-popover border border-border rounded-lg shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full px-3 py-1.5 text-xs text-left hover:bg-accent transition-colors"
            onClick={() => {
              onApply(contextMenu.index);
              setContextMenu(null);
            }}
          >
            {t("stash.apply")}
          </button>
          <button
            className="w-full px-3 py-1.5 text-xs text-left hover:bg-accent transition-colors"
            onClick={() => {
              onPop(contextMenu.index);
              setContextMenu(null);
            }}
          >
            {t("stash.pop")}
          </button>
          <div className="border-t border-border my-1" />
          <button
            className="w-full px-3 py-1.5 text-xs text-left text-danger hover:bg-danger/10 transition-colors"
            onClick={() => {
              setConfirmDrop(contextMenu.index);
              setContextMenu(null);
            }}
          >
            {t("stash.drop")}
          </button>
        </div>
      )}

      {/* Drop Confirmation Dialog */}
      {confirmDrop !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-popover border border-border rounded-xl shadow-2xl p-6 w-[360px]">
            <h3 className="text-sm font-semibold">{t("stash.dropConfirm")}</h3>
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
          </div>
        </div>
      )}
    </div>
  );
}
