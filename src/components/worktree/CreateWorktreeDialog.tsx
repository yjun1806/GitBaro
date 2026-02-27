import { useState } from "react";
import { X, FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { addWorktree } from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";
import { getErrorMessage } from "@/lib/utils";
import type { BranchInfo } from "@/types";

interface CreateWorktreeDialogProps {
  repoPath: string;
  branches: BranchInfo[];
  onClose: () => void;
}

type BranchMode = "existing" | "new";

function isValidBranchName(name: string): boolean {
  return /^[a-zA-Z0-9._/-]+$/.test(name) && !name.startsWith("/") && !name.endsWith("/");
}

export function CreateWorktreeDialog({
  repoPath,
  branches,
  onClose,
}: CreateWorktreeDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [worktreePath, setWorktreePath] = useState("");
  const [branchMode, setBranchMode] = useState<BranchMode>("existing");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [creating, setCreating] = useState(false);

  const localBranches = branches.filter((b) => !b.isRemote);
  const branchNameError =
    branchMode === "new" && newBranchName.length > 0 && !isValidBranchName(newBranchName)
      ? t("branch.invalidName")
      : null;

  const isValid =
    worktreePath.length > 0 &&
    (branchMode === "existing"
      ? selectedBranch.length > 0
      : newBranchName.length > 0 && !branchNameError);

  const handleSelectFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      setWorktreePath(selected as string);
    }
  };

  const handleCreate = async () => {
    if (!isValid || creating) return;
    setCreating(true);
    try {
      if (branchMode === "existing") {
        await addWorktree(repoPath, worktreePath, selectedBranch);
      } else {
        await addWorktree(repoPath, worktreePath, undefined, newBranchName);
      }
      await queryClient.invalidateQueries({ queryKey: ["worktrees"] });
      addToast(t("worktree.created", { path: worktreePath.split("/").pop() }), "success");
      onClose();
    } catch (err) {
      addToast(t("worktree.failedToCreate", { error: getErrorMessage(err) }), "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {t("worktree.create")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-5">
          {/* Worktree path */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("worktree.path")}
            </label>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex-1 flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors",
                  "border-border focus-within:ring-2 focus-within:ring-ring focus-within:border-primary",
                )}
              >
                <FolderGit2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={worktreePath}
                  onChange={(e) => setWorktreePath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="/path/to/worktree"
                  className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
                />
              </div>
              <button
                onClick={handleSelectFolder}
                className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-colors text-muted-foreground"
              >
                {t("common.browse")}
              </button>
            </div>
          </div>

          {/* Branch mode selection */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t("worktree.branchOption")}
            </label>
            <div className="border border-border rounded-lg overflow-hidden">
              {/* Existing branch option */}
              <label
                className={cn(
                  "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors",
                  branchMode === "existing" ? "bg-primary/5" : "hover:bg-accent",
                )}
              >
                <input
                  type="radio"
                  name="branchMode"
                  value="existing"
                  checked={branchMode === "existing"}
                  onChange={() => setBranchMode("existing")}
                  className="mt-1 accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {t("worktree.existingBranch")}
                  </p>
                  {branchMode === "existing" && (
                    <select
                      value={selectedBranch}
                      onChange={(e) => setSelectedBranch(e.target.value)}
                      className="mt-2 w-full text-sm bg-muted border border-border rounded-md px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">{t("worktree.selectBranch")}</option>
                      {localBranches.map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>

              <div className="border-t border-border" />

              {/* New branch option */}
              <label
                className={cn(
                  "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors",
                  branchMode === "new" ? "bg-primary/5" : "hover:bg-accent",
                )}
              >
                <input
                  type="radio"
                  name="branchMode"
                  value="new"
                  checked={branchMode === "new"}
                  onChange={() => setBranchMode("new")}
                  className="mt-1 accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {t("worktree.newBranch")}
                  </p>
                  {branchMode === "new" && (
                    <div className="mt-2">
                      <input
                        type="text"
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                        placeholder="feature/my-feature"
                        className={cn(
                          "w-full text-sm bg-muted border rounded-md px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-ring",
                          branchNameError ? "border-destructive" : "border-border",
                        )}
                      />
                      {branchNameError && (
                        <p className="text-xs text-destructive mt-1">{branchNameError}</p>
                      )}
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleCreate}
            disabled={!isValid || creating}
            className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors"
          >
            {creating ? t("common.loading") : t("worktree.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
