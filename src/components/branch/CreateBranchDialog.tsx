import { useState, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { BranchInfo } from "@/types";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { checkNewBranchName } from "./branch-name";
import { isSubmitEnter } from "@/lib/keyboard";

interface CreateBranchDialogProps {
  branches: BranchInfo[];
  currentBranch: string | null;
  /** Runs the whole create flow; the dialog stays busy until it settles. */
  onCreate: (name: string, fromBranch: string) => Promise<void>;
  onClose: () => void;
}

export function CreateBranchDialog({
  branches,
  currentBranch,
  onCreate,
  onClose,
}: CreateBranchDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const defaultBranch = branches.find((b) => !b.isRemote && b.isDefault);
  const defaultBranchName = defaultBranch?.name ?? "main";
  const isSameBranch = currentBranch === defaultBranchName;

  const [name, setName] = useState("");
  const [fromBranch, setFromBranch] = useState(defaultBranchName);
  const [isCreating, setIsCreating] = useState(false);
  // A ref, not just state: a second Enter can arrive before the re-render.
  const creatingRef = useRef(false);

  const problem = name.length > 0 ? checkNewBranchName(name, branches) : null;
  const valid = name.length > 0 && problem === null;
  const error =
    problem === "invalid"
      ? t("branch.invalidName")
      : problem === "exists"
        ? t("branch.alreadyExists", { name })
        : null;

  const handleCreate = async () => {
    if (!valid || creatingRef.current) return;
    creatingRef.current = true;
    setIsCreating(true);
    try {
      await onCreate(name, fromBranch);
    } finally {
      creatingRef.current = false;
      setIsCreating(false);
    }
  };

  return (
    <DialogFrame
      title={t("branch.create")}
      titleId={titleId}
      onClose={onClose}
      dismissible={!isCreating}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={isCreating}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="md" onClick={() => void handleCreate()} disabled={!valid || isCreating} busy={isCreating}>
            {t("branch.createBranch")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Branch name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11.5px] font-semibold text-(--fg2)">
            {t("branch.name")}
          </label>
          <TextInput
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            readOnly={isCreating}
            onKeyDown={(e) => {
              if (isSubmitEnter(e)) void handleCreate();
            }}
            placeholder="feature/my-feature"
            className={error ? "border-danger" : undefined}
          />
          {error && <p className="text-[11.5px] text-danger">{error}</p>}
        </div>

        {/* From branch - radio selection */}
        <div className="flex flex-col gap-2">
          <label className="text-[11.5px] font-semibold text-(--fg2)">
            {t("branch.basedOn")}
          </label>
          <div className="border border-border rounded-(--radius-item) overflow-hidden">
            {/* Default branch option */}
            <label
              className={cn(
                "flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors",
                fromBranch === defaultBranchName ? "bg-(--acc-sel)" : "hover:bg-accent",
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
                <p className="text-[12.5px] font-medium text-foreground">
                  {defaultBranchName}
                </p>
                <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">
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
                    "flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors",
                    fromBranch === currentBranch ? "bg-(--acc-sel)" : "hover:bg-accent",
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
                    <p className="text-[12.5px] font-medium text-foreground truncate">
                      {currentBranch}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">
                      {t("branch.currentBranchDesc")}
                    </p>
                  </div>
                </label>
              </>
            )}
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}
