import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import type { WorkspaceError, WorkspaceResult } from "@/stores/workspace";

interface WorkspaceNameDialogProps {
  mode: "create" | "rename";
  /** 만들 때는 계정 이름, 이름을 바꿀 때는 지금 이름. 제목과 입력 칸 초기값에 쓴다. */
  subject: string;
  initialName?: string;
  /** 스토어 액션을 부르고 결과를 돌려준다. 성공하면 창을 닫는다. */
  onSubmit: (name: string) => WorkspaceResult;
  onClose: () => void;
}

/** 워크스페이스를 만들거나 이름을 바꾸는 창. 빈 이름 같은 거부 사유는 창 안에 보여 준다. */
export function WorkspaceNameDialog({
  mode,
  subject,
  initialName = "",
  onSubmit,
  onClose,
}: WorkspaceNameDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const inputId = `${titleId}-name`;
  const errorId = `${titleId}-error`;
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<WorkspaceError | null>(null);

  const handleSubmit = () => {
    const result = onSubmit(name);
    if (result.ok) onClose();
    else setError(result.reason);
  };

  const title =
    mode === "create" ? t("workspace.createTitle", { account: subject }) : t("workspace.renameTitle");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <DialogFrame
        title={title}
        onClose={onClose}
        size="sm"
        footer={
          <>
            <Button type="button" variant="ghost" size="md" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" size="md">
              {mode === "create" ? t("workspace.createButton") : t("workspace.renameButton")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-[11.5px] font-semibold text-(--fg2)">
            {t("workspace.nameLabel")}
          </label>
          <TextInput
            id={inputId}
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder={t("workspace.namePlaceholder")}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
          />
          {error && (
            <p id={errorId} role="alert" className="text-[11.5px] text-danger">
              {t(`workspace.error.${error}`)}
            </p>
          )}
        </div>
      </DialogFrame>
    </form>
  );
}

interface DeleteWorkspaceDialogProps {
  name: string;
  /** 워크스페이스가 속한 계정의 표시 이름. 저장소가 돌아갈 자리로 안내한다. */
  accountLabel: string;
  repoCount: number;
  onConfirm: () => void;
  onClose: () => void;
}

/** 워크스페이스 삭제 확인. 저장소는 계정 바로 아래로 돌아갈 뿐 지우지 않는다는 점을 적는다. */
export function DeleteWorkspaceDialog({
  name,
  accountLabel,
  repoCount,
  onConfirm,
  onClose,
}: DeleteWorkspaceDialogProps) {
  const { t } = useTranslation();
  return (
    <DialogFrame
      title={t("workspace.deleteTitle")}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" size="md" onClick={onConfirm}>
            {t("workspace.deleteButton")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-[12.5px] text-foreground break-words">{t("workspace.deleteConfirm", { name })}</p>
        <p className="text-[11.5px] text-muted-foreground leading-relaxed">
          {t("workspace.deleteKeepsRepos", { count: repoCount, account: accountLabel })}
        </p>
      </div>
    </DialogFrame>
  );
}
