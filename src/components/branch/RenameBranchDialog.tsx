import { useState, useId, useRef } from "react";
import { X, GitBranch, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { BranchInfo } from "@/types";
import { Dialog } from "@/components/ui/Dialog";
import { checkNewBranchName } from "./branch-name";

interface RenameBranchDialogProps {
  branchName: string;
  branches: BranchInfo[];
  /** Renames the branch; the dialog stays busy until it settles. */
  onRename: (newName: string) => Promise<void>;
  onClose: () => void;
}

export function RenameBranchDialog({
  branchName,
  branches,
  onRename,
  onClose,
}: RenameBranchDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [name, setName] = useState(branchName);
  const [isRenaming, setIsRenaming] = useState(false);
  // A ref, not just state: a second Enter can arrive before the re-render.
  const renamingRef = useRef(false);

  const trimmed = name.trim();
  const problem = trimmed.length > 0 ? checkNewBranchName(trimmed, branches, branchName) : null;
  const valid = trimmed.length > 0 && trimmed !== branchName && problem === null;
  const error =
    problem === "invalid"
      ? t("branch.invalidName")
      : problem === "exists"
        ? t("branch.alreadyExists", { name: trimmed })
        : null;

  const handleRename = async () => {
    if (!valid || renamingRef.current) return;
    renamingRef.current = true;
    setIsRenaming(true);
    try {
      await onRename(trimmed);
    } finally {
      renamingRef.current = false;
      setIsRenaming(false);
    }
  };

  return (
    <Dialog
      onClose={onClose}
      dismissible={!isRenaming}
      labelledBy={titleId}
      className="bg-card rounded-xl shadow-2xl w-full max-w-md"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 id={titleId} className="text-base font-semibold text-foreground">
          {t("branch.renameTitle")}
        </h2>
        <button
          onClick={onClose}
          disabled={isRenaming}
          className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors disabled:opacity-40"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-5 py-5 flex flex-col gap-1.5">
        <label htmlFor={`${titleId}-name`} className="text-xs font-medium text-muted-foreground">
          {t("branch.name")}
        </label>
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors",
            error
              ? "border-destructive focus-within:ring-2 focus-within:ring-destructive/30"
              : "border-border focus-within:ring-2 focus-within:ring-ring focus-within:border-primary",
          )}
        >
          <GitBranch className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            id={`${titleId}-name`}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            type="text"
            value={name}
            readOnly={isRenaming}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleRename();
            }}
            className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
        <button
          onClick={onClose}
          disabled={isRenaming}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={() => void handleRename()}
          disabled={!valid || isRenaming}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors"
        >
          {isRenaming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {t("branch.contextMenu.rename")}
        </button>
      </div>
    </Dialog>
  );
}
