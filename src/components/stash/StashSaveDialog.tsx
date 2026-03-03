import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X, Check } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useStatus } from "@/api/queries";
import type { StatusEntry } from "@/types";

interface StashSaveDialogProps {
  onSave: (message?: string, paths?: string[]) => void;
  onClose: () => void;
}

export function StashSaveDialog({ onSave, onClose }: StashSaveDialogProps) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);

  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  const changedFiles = useMemo(
    () =>
      statusEntries.filter(
        (e) =>
          e.status !== "ignored" &&
          (e.staged || e.status !== "untracked" || e.staged),
      ),
    [statusEntries],
  );

  // Deduplicate paths (a file can appear as both staged + unstaged)
  const uniqueFiles = useMemo(() => {
    const seen = new Set<string>();
    const result: StatusEntry[] = [];
    for (const f of changedFiles) {
      if (!seen.has(f.path)) {
        seen.add(f.path);
        result.push(f);
      }
    }
    return result;
  }, [changedFiles]);

  const togglePath = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedPaths.size === uniqueFiles.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(uniqueFiles.map((f) => f.path)));
    }
  };

  const handleSave = () => {
    const msg = message.trim() || undefined;
    if (mode === "all") {
      onSave(msg);
    } else {
      const paths = Array.from(selectedPaths);
      if (paths.length > 0) {
        onSave(msg, paths);
      }
    }
  };

  const canSave =
    mode === "all"
      ? uniqueFiles.length > 0
      : selectedPaths.size > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-popover border border-border rounded-xl shadow-2xl w-[440px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">{t("stash.saveDialog.title")}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-accent transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Message */}
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("stash.saveDialog.messagePlaceholder")}
            className="w-full px-3 py-2 text-xs bg-input border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />

          {/* Mode Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode("all")}
              className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
                mode === "all"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-accent"
              }`}
            >
              {t("stash.saveDialog.stashAll")}
            </button>
            <button
              onClick={() => setMode("selected")}
              className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
                mode === "selected"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-accent"
              }`}
            >
              {t("stash.saveDialog.stashSelected")}
            </button>
          </div>

          {/* File Selection (partial mode) */}
          {mode === "selected" && (
            <div className="border border-border rounded-md">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface">
                <span className="text-xs text-muted-foreground">
                  {t("stash.saveDialog.selectFiles")}
                </span>
                <button
                  onClick={toggleAll}
                  className="text-xs text-primary hover:underline"
                >
                  {selectedPaths.size === uniqueFiles.length
                    ? t("stash.saveDialog.deselectAll")
                    : t("stash.saveDialog.selectAll")}
                </button>
              </div>
              <div className="max-h-[240px] overflow-y-auto">
                {uniqueFiles.map((file) => (
                  <label
                    key={file.path}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer transition-colors"
                    onClick={() => togglePath(file.path)}
                  >
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        selectedPaths.has(file.path)
                          ? "bg-primary border-primary"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {selectedPaths.has(file.path) && (
                        <Check className="w-3 h-3 text-white" />
                      )}
                    </div>
                    <span className="text-xs truncate flex-1">{file.path}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {file.status}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs rounded-md hover:bg-accent transition-colors"
          >
            {t("stash.saveDialog.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="px-4 py-2 text-xs rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t("stash.saveDialog.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
