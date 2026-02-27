import { useState } from "react";
import { FolderGit2, Trash2, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
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
        return (
          <div key={wt.path} className="relative group">
            <div className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors">
              <button
                onClick={() => onOpen(wt.path)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                <FolderGit2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm text-foreground truncate"
                    title={wt.path}
                  >
                    {wt.path.split("/").pop()}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {wt.branch ?? t("worktree.detachedHead")}
                  </p>
                </div>
              </button>
              {wt.isDirty && (
                <span className="w-2 h-2 rounded-full bg-warning shrink-0" title={t("worktree.dirty")} />
              )}
              {wt.isMain && (
                <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                  {t("worktree.main")}
                </span>
              )}
              {!wt.isMain && wt.isLocked && (
                <span title={wt.lockReason ?? t("worktree.locked")}>
                  <Lock className="w-3 h-3 text-warning shrink-0" />
                </span>
              )}
              {!wt.isMain && !wt.isLocked && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmRemove(wt.path);
                  }}
                  className="p-1 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                  title={t("worktree.remove")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {confirmRemove === wt.path && (
              <div className="absolute inset-x-0 bottom-full mb-1 mx-2 bg-card border border-border rounded-lg shadow-lg p-3 z-10">
                <p className="text-sm text-foreground mb-2">
                  {t("worktree.removeConfirm", {
                    path: wt.path.split("/").pop(),
                  })}
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
    </div>
  );
}
