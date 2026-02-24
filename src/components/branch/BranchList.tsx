import { useState } from "react";
import { GitBranch, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { BranchInfo } from "@/types";

interface BranchListProps {
  branches: BranchInfo[];
  currentBranch: string | null;
  onDelete: (branch: BranchInfo) => void;
}

export function BranchList({ branches, currentBranch, onDelete }: BranchListProps) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const local = branches.filter((b) => !b.isRemote);

  const handleDeleteClick = (branch: BranchInfo) => {
    setConfirmDelete(branch.name);
  };

  const handleConfirm = (branch: BranchInfo) => {
    onDelete(branch);
    setConfirmDelete(null);
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      {local.map((branch) => (
        <div
          key={branch.name}
          className={clsx(
            "relative flex items-center gap-2 px-3 py-2 rounded-lg",
            branch.name === currentBranch
              ? "bg-primary/10"
              : "hover:bg-accent"
          )}
        >
          <GitBranch
            className={clsx(
              "w-4 h-4 shrink-0",
              branch.name === currentBranch
                ? "text-primary"
                : "text-muted-foreground"
            )}
          />
          <div className="flex-1 min-w-0">
            <p
              className={clsx(
                "text-sm font-medium truncate",
                branch.name === currentBranch
                  ? "text-primary"
                  : "text-foreground"
              )}
            >
              {branch.name}
              {branch.isHead && (
                <span className="ml-2 text-xs text-primary">HEAD</span>
              )}
            </p>
            {branch.upstream && (
              <p className="text-xs text-muted-foreground truncate">{branch.upstream}</p>
            )}
          </div>

          {branch.aheadBehind && (
            <div className="flex items-center gap-1 text-xs">
              {branch.aheadBehind.ahead > 0 && (
                <span className="text-success">↑{branch.aheadBehind.ahead}</span>
              )}
              {branch.aheadBehind.behind > 0 && (
                <span className="text-destructive">↓{branch.aheadBehind.behind}</span>
              )}
            </div>
          )}

          {branch.name !== currentBranch && (
            <button
              onClick={() => handleDeleteClick(branch)}
              className="p-1 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
              title={t("branch.delete")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Inline confirm */}
          {confirmDelete === branch.name && (
            <div className="absolute inset-x-0 bottom-full mb-1 mx-2 bg-card border border-border rounded-lg shadow-lg p-3 z-10">
              <p className="text-sm text-foreground mb-2">
                {t("branch.deleteConfirm", { name: branch.name })}
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleConfirm(branch)}
                  className="px-3 py-1 text-xs bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
