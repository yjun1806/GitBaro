import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { useStashList, useStashMutations } from "@/api/queries";
import { getErrorMessage } from "@/lib/utils";
import { StashList } from "./StashList";
import { StashSaveDialog } from "./StashSaveDialog";

interface StashViewProps {
  selectedIndex: number | null;
  onSelectStash: (index: number | null) => void;
}

export function StashView({ selectedIndex, onSelectStash }: StashViewProps) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const addToast = useToastStore((s) => s.addToast);
  const { data: stashes = [] } = useStashList(activeRepoPath);
  const mutations = useStashMutations(activeRepoPath);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const handleApply = async (index: number) => {
    try {
      await mutations.apply.mutateAsync(index);
      addToast(t("stash.applied"), "success");
    } catch (err) {
      addToast(t("stash.failedToApply", { error: getErrorMessage(err) }), "error");
    }
  };

  const handlePop = async (_index: number) => {
    try {
      await mutations.pop.mutateAsync();
      onSelectStash(null);
      addToast(t("stash.popped"), "success");
    } catch (err) {
      addToast(t("stash.failedToPop", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleDrop = async (index: number) => {
    try {
      await mutations.drop.mutateAsync(index);
      if (selectedIndex === index) {
        onSelectStash(null);
      }
      addToast(t("stash.dropped"), "success");
    } catch (err) {
      addToast(t("stash.failedToDrop", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleSave = async (message?: string, paths?: string[]) => {
    try {
      if (paths) {
        await mutations.pushPartial.mutateAsync({ paths, message });
      } else {
        await mutations.push.mutateAsync(message);
      }
      setShowSaveDialog(false);
      addToast(t("stash.saved"), "success");
    } catch (err) {
      addToast(t("stash.failedToSave", { error: getErrorMessage(err) }), "error");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium">{t("stash.title")}</span>
        <button
          onClick={() => setShowSaveDialog(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md hover:bg-accent transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("stash.save")}
        </button>
      </div>

      {/* Stash List */}
      <StashList
        stashes={stashes}
        selectedIndex={selectedIndex}
        onSelectStash={onSelectStash}
        onApply={handleApply}
        onPop={handlePop}
        onDrop={handleDrop}
      />

      {/* Save Dialog */}
      {showSaveDialog && (
        <StashSaveDialog
          onSave={handleSave}
          onClose={() => setShowSaveDialog(false)}
        />
      )}
    </div>
  );
}
