import { useState } from "react";
import { X, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { BranchInfo } from "@/types";

interface CreateBranchDialogProps {
  branches: BranchInfo[];
  currentBranch: string | null;
  onCreate: (name: string, fromBranch: string) => void;
  onClose: () => void;
}

function isValidBranchName(name: string): boolean {
  return /^[a-zA-Z0-9._/-]+$/.test(name) && !name.startsWith("/") && !name.endsWith("/");
}

export function CreateBranchDialog({
  branches,
  currentBranch,
  onCreate,
  onClose,
}: CreateBranchDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [fromBranch, setFromBranch] = useState(currentBranch ?? "");

  const valid = name.length > 0 && isValidBranchName(name);
  const error = name.length > 0 && !valid ? t("branch.invalidName") : null;

  const localBranches = branches.filter((b) => !b.isRemote);

  const handleCreate = () => {
    if (!valid) return;
    onCreate(name, fromBranch);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {t("branch.create")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          {/* Branch name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("branch.name")}
            </label>
            <div
              className={clsx(
                "flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors",
                error
                  ? "border-destructive focus-within:ring-2 focus-within:ring-destructive/30"
                  : "border-border focus-within:ring-2 focus-within:ring-ring focus-within:border-primary"
              )}
            >
              <GitBranch className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="feature/my-feature"
                className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
              />
            </div>
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>

          {/* From branch */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("branch.from")}
            </label>
            <select
              value={fromBranch}
              onChange={(e) => setFromBranch(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              {localBranches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                  {b.isHead ? ` ${t("branch.currentTag")}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleCreate}
            disabled={!valid}
            className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors"
          >
            {t("branch.createBranch")}
          </button>
        </div>
      </div>
    </div>
  );
}
