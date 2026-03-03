import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { WorktreeIcon } from "@/components/ui/WorktreeIcon";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { addWorktree } from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";
import { getErrorMessage } from "@/lib/utils";
import { BranchCombobox } from "@/components/ui/BranchCombobox";
import type { BranchInfo, WorktreeInfo } from "@/types";

interface CreateWorktreeDialogProps {
  repoPath: string;
  branches: BranchInfo[];
  worktrees: WorktreeInfo[];
  onClose: () => void;
}

type BranchMode = "existing" | "new";

function isValidBranchName(name: string): boolean {
  return /^[a-zA-Z0-9._/-]+$/.test(name) && !name.startsWith("/") && !name.endsWith("/");
}

function suggestWorktreePath(repoPath: string, branchName: string): string {
  const safeBranch = branchName.replace(/\//g, "-").replace(/^-+|-+$/g, "");
  if (!safeBranch) return "";
  const lastSlash = repoPath.lastIndexOf("/");
  const parentDir = lastSlash > 0 ? repoPath.slice(0, lastSlash) : repoPath;
  const repoName = repoPath.slice(lastSlash + 1);
  return `${parentDir}/${repoName}-${safeBranch}`;
}

export function CreateWorktreeDialog({
  repoPath,
  branches,
  worktrees,
  onClose,
}: CreateWorktreeDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [branchMode, setBranchMode] = useState<BranchMode>("existing");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [worktreePath, setWorktreePath] = useState("");
  const [pathIsManual, setPathIsManual] = useState(false);
  const [creating, setCreating] = useState(false);

  const allLocalBranches = branches.filter((b) => !b.isRemote);
  // Branches already checked out in worktrees (cannot be reused for "existing branch" mode)
  const checkedOutBranches = new Set(
    worktrees.map((w) => w.branch).filter((b): b is string => b !== null),
  );
  const availableBranches = allLocalBranches.filter((b) => !checkedOutBranches.has(b.name));

  // Set default baseBranch to the default branch (main/master) or first local branch
  useEffect(() => {
    if (baseBranch) return;
    const defaultBranch = allLocalBranches.find(
      (b) => b.name === "main" || b.name === "master",
    );
    if (defaultBranch) {
      setBaseBranch(defaultBranch.name);
    } else if (allLocalBranches.length > 0) {
      setBaseBranch(allLocalBranches[0].name);
    }
  }, [allLocalBranches, baseBranch]);

  // Auto-generate path when branch changes and pathIsManual is false
  const activeBranchName = branchMode === "existing" ? selectedBranch : newBranchName;
  useEffect(() => {
    if (pathIsManual) return;
    if (!activeBranchName) {
      setWorktreePath("");
      return;
    }
    setWorktreePath(suggestWorktreePath(repoPath, activeBranchName));
  }, [activeBranchName, repoPath, pathIsManual]);

  const branchNameError =
    branchMode === "new" && newBranchName.length > 0 && !isValidBranchName(newBranchName)
      ? t("branch.invalidName")
      : null;

  const isValid =
    worktreePath.length > 0 &&
    (branchMode === "existing"
      ? selectedBranch.length > 0
      : newBranchName.length > 0 && !branchNameError);

  const handlePathChange = (value: string) => {
    setWorktreePath(value);
    if (value === "") {
      setPathIsManual(false);
    } else {
      setPathIsManual(true);
    }
  };

  const handleSelectFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      setWorktreePath(selected as string);
      setPathIsManual(true);
    }
  };

  const handleCreate = async () => {
    if (!isValid || creating) return;
    setCreating(true);
    try {
      if (branchMode === "existing") {
        await addWorktree(repoPath, worktreePath, selectedBranch);
      } else {
        await addWorktree(repoPath, worktreePath, undefined, newBranchName, baseBranch || undefined);
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
          {/* Branch mode selection (moved FIRST) */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t("worktree.branchOption")}
            </label>
            <div className="border border-border rounded-lg">
              {/* Existing branch option */}
              <label
                className={cn(
                  "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors rounded-t-lg",
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
                    <BranchCombobox
                      value={selectedBranch}
                      onChange={setSelectedBranch}
                      branches={availableBranches}
                      placeholder={t("worktree.selectBranch")}
                      className="mt-2"
                    />
                  )}
                </div>
              </label>

              <div className="border-t border-border" />

              {/* New branch option */}
              <label
                className={cn(
                  "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors rounded-b-lg",
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
                    <div className="mt-2 flex flex-col gap-3">
                      <input
                        type="text"
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                        placeholder="feature/my-feature"
                        className={cn(
                          "w-full text-sm bg-background border rounded-md px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-ring",
                          branchNameError ? "border-destructive" : "border-border",
                        )}
                      />
                      {branchNameError && (
                        <p className="text-xs text-destructive">{branchNameError}</p>
                      )}
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {t("worktree.baseBranch")}
                        </span>
                        <BranchCombobox
                          value={baseBranch}
                          onChange={setBaseBranch}
                          branches={allLocalBranches}
                          placeholder={t("worktree.baseBranchPlaceholder")}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>

          {/* Worktree path (moved SECOND, disabled until branch selected) */}
          <div className={cn("flex flex-col gap-1.5 transition-opacity", !activeBranchName && "opacity-50 pointer-events-none")}>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                {t("worktree.path")}
              </label>
              {!pathIsManual && worktreePath && (
                <span className="text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
                  {t("worktree.pathAutoGenerated")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex-1 flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors",
                  "border-border focus-within:ring-2 focus-within:ring-ring focus-within:border-primary",
                )}
              >
                <WorktreeIcon className="w-4 h-4" />
                <input
                  type="text"
                  value={worktreePath}
                  onChange={(e) => handlePathChange(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder={activeBranchName ? "/path/to/worktree" : t("worktree.selectBranch")}
                  disabled={!activeBranchName}
                  className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none disabled:cursor-not-allowed"
                />
              </div>
              <button
                onClick={handleSelectFolder}
                disabled={!activeBranchName}
                className="whitespace-nowrap shrink-0 px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-colors text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("common.browse")}
              </button>
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
