import { useState, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { BranchInfo } from "@/types";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
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
    <DialogFrame
      title={t("branch.renameTitle")}
      onClose={onClose}
      dismissible={!isRenaming}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={isRenaming}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void handleRename()}
            disabled={!valid || isRenaming}
            busy={isRenaming}
          >
            {t("branch.contextMenu.rename")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${titleId}-name`} className="text-[11.5px] font-semibold text-(--fg2)">
          {t("branch.name")}
        </label>
        <TextInput
          id={`${titleId}-name`}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={name}
          readOnly={isRenaming}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleRename();
          }}
        />
        {error && (
          <p className="text-[11.5px] text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </DialogFrame>
  );
}
