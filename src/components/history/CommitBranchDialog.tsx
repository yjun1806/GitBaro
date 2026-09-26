import { useState, useId } from "react";
import { useTranslation } from "react-i18next";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { isSubmitEnter } from "@/lib/keyboard";

interface CommitBranchDialogProps {
  shortId: string;
  onCreate: (name: string) => void;
  onClose: () => void;
}

function isValidBranchName(name: string): boolean {
  return /^[a-zA-Z0-9._/-]+$/.test(name) && !name.startsWith("/") && !name.endsWith("/");
}

/**
 * 특정 커밋에서 새 브랜치를 만들 때 이름을 입력받는 경량 다이얼로그.
 * (CreateBranchDialog는 base 브랜치 선택형이라 커밋 기반에는 별도 사용.)
 */
export function CommitBranchDialog({ shortId, onCreate, onClose }: CommitBranchDialogProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const [name, setName] = useState("");

  const valid = name.length > 0 && isValidBranchName(name);
  const error = name.length > 0 && !valid ? t("branch.invalidName") : null;

  const handleCreate = () => {
    if (valid) onCreate(name);
  };

  return (
    <DialogFrame
      title={t("history.createBranchFrom", { shortId })}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="md" onClick={handleCreate} disabled={!valid}>
            {t("branch.createBranch")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-[11.5px] font-semibold text-(--fg2)">
          {t("branch.name")}
        </label>
        <TextInput
          id={inputId}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => isSubmitEnter(e) && handleCreate()}
          placeholder="feature/my-feature"
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
