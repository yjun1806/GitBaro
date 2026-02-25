import { useState } from "react";
import { X, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
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
  const defaultBranch = branches.find((b) => !b.isRemote && b.isDefault);
  const defaultBranchName = defaultBranch?.name ?? "main";
  const isSameBranch = currentBranch === defaultBranchName;

  const [name, setName] = useState("");
  const [fromBranch, setFromBranch] = useState(defaultBranchName);

  const valid = name.length > 0 && isValidBranchName(name);
  const error = name.length > 0 && !valid ? t("branch.invalidName") : null;

  const handleCreate = () => {
    if (!valid) return;
    onCreate(name, fromBranch);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md">
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

        <div className="px-5 py-5 flex flex-col gap-5">
          {/* Branch name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
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

          {/* From branch - radio selection */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t("branch.basedOn")}
            </label>
            <div className="border border-border rounded-lg overflow-hidden">
              {/* Default branch option */}
              <label
                className={cn(
                  "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors",
                  fromBranch === defaultBranchName
                    ? "bg-primary/5"
                    : "hover:bg-accent",
                )}
              >
                <input
                  type="radio"
                  name="fromBranch"
                  value={defaultBranchName}
                  checked={fromBranch === defaultBranchName}
                  onChange={() => setFromBranch(defaultBranchName)}
                  className="mt-1 accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {defaultBranchName}
                  </p>
                  <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">
                    {t("branch.defaultBranchDesc")}
                  </p>
                </div>
              </label>

              {/* Current branch option (only if different from default) */}
              {!isSameBranch && currentBranch && (
                <>
                  <div className="border-t border-border" />
                  <label
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors",
                      fromBranch === currentBranch
                        ? "bg-primary/5"
                        : "hover:bg-accent",
                    )}
                  >
                    <input
                      type="radio"
                      name="fromBranch"
                      value={currentBranch}
                      checked={fromBranch === currentBranch}
                      onChange={() => setFromBranch(currentBranch)}
                      className="mt-1 accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {currentBranch}
                      </p>
                      <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">
                        {t("branch.currentBranchDesc")}
                      </p>
                    </div>
                  </label>
                </>
              )}
            </div>
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
