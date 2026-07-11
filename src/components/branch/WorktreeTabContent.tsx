import { useState } from "react";
import { GitBranch, Trash2, Lock } from "lucide-react";
import { WorktreeIcon } from "@/components/ui/WorktreeIcon";
import { useTranslation } from "react-i18next";
import { WorktreeContextMenu } from "@/components/branch/WorktreeContextMenu";
import type { WorktreeInfo } from "@/types";

interface WorktreeTabContentProps {
  worktrees: WorktreeInfo[];
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}

export function WorktreeTabContent({
  worktrees,
  onOpen,
  onRemove,
}: WorktreeTabContentProps) {
  const { t } = useTranslation();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ wt: WorktreeInfo; x: number; y: number } | null>(null);

  if (worktrees.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t("worktree.noWorktrees")}
        </p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {worktrees.map((wt) => {
        const dirName = wt.path.split("/").pop() ?? wt.path;
        const parentDir = wt.path.slice(0, wt.path.length - dirName.length - 1);

        return (
          <div key={wt.path} className="relative group">
            <button
              onClick={() => onOpen(wt.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ wt, x: e.clientX, y: e.clientY });
              }}
              className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-accent transition-colors"
            >
              <WorktreeIcon className="w-4 h-4 mt-0.5" />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-foreground truncate">
                    {dirName}
                  </span>
                  {wt.isDirty && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-warning shrink-0"
                      title={t("worktree.dirty")}
                    />
                  )}
                  {wt.isLocked && (
                    <span title={wt.lockReason ?? t("worktree.locked")}>
                      <Lock className="w-3 h-3 text-warning shrink-0" />
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 mt-0.5">
                  <GitBranch className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground truncate">
                    {wt.branch ?? t("worktree.detachedHead")}
                  </span>
                </div>

                <p
                  className="text-[11px] text-muted-foreground/50 truncate mt-0.5"
                  title={wt.path}
                >
                  {parentDir}
                </p>
              </div>

              {!wt.isLocked && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmRemove(wt.path);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      setConfirmRemove(wt.path);
                    }
                  }}
                  className="p-1 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
                  title={t("worktree.remove")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </div>
              )}
            </button>

            {confirmRemove === wt.path && (
              <div className="absolute inset-x-0 bottom-full mb-1 mx-2 bg-card border border-border rounded-lg shadow-lg p-3 z-10">
                <p className="text-sm text-foreground mb-2">
                  {t("worktree.removeConfirm", { path: dirName })}
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setConfirmRemove(null)}
                    className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={() => {
                      onRemove(wt.path);
                      setConfirmRemove(null);
                    }}
                    className="px-3 py-1 text-xs bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded transition-colors"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {menu && (
        <WorktreeContextMenu
          isLocked={menu.wt.isLocked}
          position={{ x: menu.x, y: menu.y }}
          onOpen={() => onOpen(menu.wt.path)}
          onCopyPath={() => navigator.clipboard.writeText(menu.wt.path)}
          onRemove={() => setConfirmRemove(menu.wt.path)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
