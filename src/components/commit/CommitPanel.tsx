import { useState } from "react";
import { GitCommit } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { useUIStore } from "@/stores/ui";
import { CommitMessage } from "./CommitMessage";

interface CommitPanelProps {
  currentBranch: string | null;
  stagedCount: number;
  onCommit: (summary: string, description: string, amend: boolean) => void;
}

export function CommitPanel({ currentBranch, stagedCount, onCommit }: CommitPanelProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [amend, setAmend] = useState(false);
  const previewBranch = useUIStore((s) => s.previewBranch);

  const canCommit = !previewBranch && ((summary.trim().length > 0 && stagedCount > 0) || amend);

  const handleCommit = () => {
    if (!canCommit) return;
    onCommit(summary.trim(), description.trim(), amend);
    setSummary("");
    setDescription("");
    setAmend(false);
  };

  return (
    <div className="flex flex-col gap-3 p-3 border-t border-border">
      {/* Summary input */}
      <CommitMessage
        value={summary}
        onChange={setSummary}
        placeholder={t("commit.summary")}
      />

      {/* Description textarea */}
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("commit.description")}
        rows={3}
        className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-transparent text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring focus:border-primary resize-none"
      />

      {/* Co-authors placeholder */}
      <div className="text-xs text-muted-foreground/50 italic px-1">
        {t("commit.coauthors")}
      </div>

      {/* Amend checkbox */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={amend}
          onChange={(e) => setAmend(e.target.checked)}
          className="w-3.5 h-3.5 rounded border-gray-300 text-primary focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">
          {t("commit.amend")}
        </span>
      </label>

      {/* Commit button */}
      <button
        onClick={handleCommit}
        disabled={!canCommit}
        className={clsx(
          "flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors",
          canCommit
            ? "bg-primary hover:bg-primary-hover text-primary-foreground"
            : "bg-muted text-muted-foreground cursor-not-allowed"
        )}
      >
        <GitCommit className="w-4 h-4" />
        {previewBranch
          ? t("preview.disabledCommit")
          : stagedCount === 0 && !amend
            ? t("commit.noStagedFiles")
            : t("commit.submit", { branch: currentBranch ?? "HEAD" })}
      </button>
    </div>
  );
}
