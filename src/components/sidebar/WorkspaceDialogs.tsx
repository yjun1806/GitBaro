import { useId, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/ui/Dialog";
import { FLOATING_SURFACE } from "@/components/ui/layers";
import type { WorkspaceError, WorkspaceResult } from "@/stores/workspace";

const PANEL = `rounded-xl w-full max-w-sm ${FLOATING_SURFACE}`;

interface DialogHeaderProps {
  titleId: string;
  title: string;
  onClose: () => void;
}

function DialogHeader({ titleId, title, onClose }: DialogHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
      <h2 id={titleId} className="text-base font-semibold text-foreground truncate">
        {title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.cancel")}
        className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

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
  const inputId = useId();
  const errorId = useId();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<WorkspaceError | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = onSubmit(name);
    if (result.ok) onClose();
    else setError(result.reason);
  };

  const title =
    mode === "create" ? t("workspace.createTitle", { account: subject }) : t("workspace.renameTitle");

  return (
    <Dialog onClose={onClose} labelledBy={titleId} className={PANEL}>
      <form onSubmit={handleSubmit}>
        <DialogHeader titleId={titleId} title={title} onClose={onClose} />
        <div className="px-5 py-5 flex flex-col gap-2">
          <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
            {t("workspace.nameLabel")}
          </label>
          <input
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
            className="h-8 px-2.5 rounded-[var(--radius-item)] bg-card border border-border text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
          />
          {error && (
            <p id={errorId} role="alert" className="text-xs text-danger">
              {t(`workspace.error.${error}`)}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg transition-colors"
          >
            {mode === "create" ? t("workspace.createButton") : t("workspace.renameButton")}
          </button>
        </div>
      </form>
    </Dialog>
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
  const titleId = useId();
  return (
    <Dialog onClose={onClose} labelledBy={titleId} className={PANEL}>
      <DialogHeader titleId={titleId} title={t("workspace.deleteTitle")} onClose={onClose} />
      <div className="px-5 py-5 flex flex-col gap-2">
        <p className="text-sm text-foreground break-words">{t("workspace.deleteConfirm", { name })}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("workspace.deleteKeepsRepos", { count: repoCount, account: accountLabel })}
        </p>
      </div>
      <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="px-4 py-2 text-sm font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-lg transition-colors"
        >
          {t("workspace.deleteButton")}
        </button>
      </div>
    </Dialog>
  );
}
