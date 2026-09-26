import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { addWorktree } from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";
import { getErrorMessage } from "@/lib/utils";
import { suggestWorktreePath } from "./worktree-path";
import { usePreferencesStore } from "@/stores/preferences";
import { BranchCombobox } from "@/components/ui/BranchCombobox";
import type { BranchInfo, WorktreeInfo } from "@/types";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { isSubmitEnter } from "@/lib/keyboard";

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

export function CreateWorktreeDialog({
  repoPath,
  branches,
  worktrees,
  onClose,
}: CreateWorktreeDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const worktreeParentDir = usePreferencesStore((s) => s.worktreeParentDir);

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
    setWorktreePath(suggestWorktreePath(repoPath, activeBranchName, worktreeParentDir));
  }, [activeBranchName, repoPath, pathIsManual, worktreeParentDir]);

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
    <DialogFrame
      title={t("worktree.create")}
      onClose={onClose}
      dismissible={!creating}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={creating}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="md" onClick={handleCreate} disabled={!isValid || creating} busy={creating}>
            {t("worktree.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Branch mode selection (moved FIRST) */}
        <div className="flex flex-col gap-2">
          <label className="text-[11.5px] font-semibold text-(--fg2)">{t("worktree.branchOption")}</label>
          <div className="border border-border rounded-(--radius-item) overflow-hidden">
            {/* Existing branch option */}
            <label
              className={cn(
                "flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors",
                branchMode === "existing" ? "bg-(--acc-sel)" : "hover:bg-accent",
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
                <p className="text-[12.5px] font-medium text-foreground">
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
                "flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors",
                branchMode === "new" ? "bg-(--acc-sel)" : "hover:bg-accent",
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
                <p className="text-[12.5px] font-medium text-foreground">
                  {t("worktree.newBranch")}
                </p>
                {branchMode === "new" && (
                  <div className="mt-2 flex flex-col gap-3">
                    <TextInput
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      onKeyDown={(e) => isSubmitEnter(e) && handleCreate()}
                      placeholder="feature/my-feature"
                      className={branchNameError ? "border-danger" : undefined}
                    />
                    {branchNameError && (
                      <p className="text-[11.5px] text-danger">{branchNameError}</p>
                    )}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11.5px] text-muted-foreground">
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
            <label className="text-[11.5px] font-semibold text-(--fg2)">
              {t("worktree.path")}
            </label>
            {!pathIsManual && worktreePath && (
              <span className="text-[11.5px] text-muted-foreground">{t("worktree.pathAutoGenerated")}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <TextInput
              value={worktreePath}
              onChange={(e) => handlePathChange(e.target.value)}
              onKeyDown={(e) => isSubmitEnter(e) && handleCreate()}
              placeholder={activeBranchName ? "/path/to/worktree" : t("worktree.selectBranch")}
              disabled={!activeBranchName}
              className="flex-1"
            />
            <Button variant="secondary" size="md" onClick={handleSelectFolder} disabled={!activeBranchName}>
              {t("common.browse")}
            </Button>
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}
