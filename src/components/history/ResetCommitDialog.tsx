import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ResetMode } from "@/api/commands";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

interface ResetCommitDialogProps {
  shortId: string;
  onConfirm: (mode: ResetMode) => void;
  onClose: () => void;
}

const MODES: ResetMode[] = ["soft", "mixed", "hard"];

/**
 * 현재 브랜치를 특정 커밋으로 리셋할 때 모드(soft/mixed/hard)를 고르는 다이얼로그.
 * hard는 워킹 트리 변경을 삭제하므로 경고를 표시한다.
 */
export function ResetCommitDialog({ shortId, onConfirm, onClose }: ResetCommitDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ResetMode>("mixed");

  return (
    <DialogFrame
      title={t("history.reset.title", { shortId })}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant={mode === "hard" ? "danger" : "primary"} size="md" onClick={() => onConfirm(mode)}>
            {t("history.reset.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="border border-border rounded-(--radius-item) overflow-hidden">
          {MODES.map((m, i) => (
            <label
              key={m}
              className={cn(
                "flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors",
                i > 0 && "border-t border-border",
                mode === m ? "bg-(--acc-sel)" : "hover:bg-accent",
              )}
            >
              <input
                type="radio"
                name="resetMode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="mt-1 accent-primary"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-medium text-foreground">
                  {t(`history.reset.${m}`)}
                </p>
                <p className="text-[11.5px] text-muted-foreground mt-0.5">
                  {t(`history.reset.${m}Desc`)}
                </p>
              </div>
            </label>
          ))}
        </div>

        {mode === "hard" && (
          <Notice tone="warning" icon={AlertTriangle}>
            {t("history.reset.hardWarning")}
          </Notice>
        )}
      </div>
    </DialogFrame>
  );
}
