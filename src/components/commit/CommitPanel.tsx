import { useState } from "react";
import { GitCommit } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
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

  const canCommit = (summary.trim().length > 0 && stagedCount > 0) || amend;

  const handleCommit = () => {
    if (!canCommit) return;
    onCommit(summary.trim(), description.trim(), amend);
    setSummary("");
    setDescription("");
    setAmend(false);
  };

  return (
    <div className="flex flex-col gap-3 p-3 border-t border-gray-200 dark:border-gray-800">
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
        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
      />

      {/* Co-authors placeholder */}
      <div className="text-xs text-gray-300 dark:text-gray-600 italic px-1">
        Co-authors — coming soon
      </div>

      {/* Amend checkbox */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={amend}
          onChange={(e) => setAmend(e.target.checked)}
          className="w-3.5 h-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">
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
            ? "bg-blue-600 hover:bg-blue-700 text-white"
            : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
        )}
      >
        <GitCommit className="w-4 h-4" />
        {stagedCount === 0 && !amend
          ? t("commit.noStagedFiles")
          : t("commit.submit", { branch: currentBranch ?? "HEAD" })}
      </button>
    </div>
  );
}
