import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ResetMode } from "@/api/commands";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {t("history.reset.title", { shortId })}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-2">
          <div className="border border-border rounded-lg overflow-hidden">
            {MODES.map((m, i) => (
              <label
                key={m}
                className={cn(
                  "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors",
                  i > 0 && "border-t border-border",
                  mode === m ? "bg-primary/5" : "hover:bg-accent",
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
                  <p className="text-sm font-medium text-foreground">
                    {t(`history.reset.${m}`)}
                  </p>
                  <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">
                    {t(`history.reset.${m}Desc`)}
                  </p>
                </div>
              </label>
            ))}
          </div>

          {mode === "hard" && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-warning/10 border border-warning/20">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning leading-relaxed">
                {t("history.reset.hardWarning")}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => onConfirm(mode)}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-lg transition-colors text-primary-foreground",
              mode === "hard"
                ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                : "bg-primary hover:bg-primary-hover",
            )}
          >
            {t("history.reset.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
