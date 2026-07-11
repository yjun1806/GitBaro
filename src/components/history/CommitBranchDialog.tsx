import { useState } from "react";
import { X, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

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
  const [name, setName] = useState("");

  const valid = name.length > 0 && isValidBranchName(name);
  const error = name.length > 0 && !valid ? t("branch.invalidName") : null;

  const handleCreate = () => {
    if (valid) onCreate(name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {t("history.createBranchFrom", { shortId })}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-1.5">
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
          {error && <p className="text-xs text-destructive">{error}</p>}
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
