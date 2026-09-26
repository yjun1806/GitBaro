import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useStatus } from "@/api/queries";
import type { StatusEntry } from "@/types";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/TextInput";
import { Segmented } from "@/components/ui/Segmented";

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
    <DialogFrame
      title={t("stash.saveDialog.title")}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button size="md" variant="ghost" onClick={onClose}>
            {t("stash.saveDialog.cancel")}
          </Button>
          <Button size="md" variant="primary" onClick={handleSave} disabled={!canSave}>
            {t("stash.saveDialog.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Message */}
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("stash.saveDialog.messagePlaceholder")}
          rows={2}
        />

        {/* Mode Toggle */}
        <Segmented<"all" | "selected">
          value={mode}
          onChange={setMode}
          options={[
            { value: "all", label: t("stash.saveDialog.stashAll") },
            { value: "selected", label: t("stash.saveDialog.stashSelected") },
          ]}
          size="md"
        />

        {/* File Selection (partial mode) */}
        {mode === "selected" && (
          <div className="border border-border rounded-(--radius-item)">
            <div className="flex items-center justify-between px-3 py-2 border-b border-(--line) bg-(--chip)">
              <span className="text-[11.5px] text-muted-foreground">
                {t("stash.saveDialog.selectFiles")}
              </span>
              <Button size="sm" variant="ghost" onClick={toggleAll}>
                {selectedPaths.size === uniqueFiles.length
                  ? t("stash.saveDialog.deselectAll")
                  : t("stash.saveDialog.selectAll")}
              </Button>
            </div>
            <div className="max-h-[240px] overflow-y-auto">
              {uniqueFiles.map((file) => (
                <label
                  key={file.path}
                  className="flex items-center gap-2 h-7 px-3 hover:bg-accent cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={selectedPaths.has(file.path)}
                    onChange={() => togglePath(file.path)}
                  />
                  <span className="text-[12.5px] truncate flex-1">{file.path}</span>
                  <span className="text-[11.5px] text-muted-foreground shrink-0">
                    {t(`fileStatus.${file.status}`, { defaultValue: file.status })}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </DialogFrame>
  );
}
