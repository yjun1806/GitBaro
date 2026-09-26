import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { useSelectionStore } from "@/stores/selection";
import { useStashList, useStashMutations } from "@/api/queries";
import { getErrorMessage } from "@/lib/utils";
import { StashList } from "./StashList";
import { StashSaveDialog } from "./StashSaveDialog";
import { Button } from "@/components/ui/Button";

export function StashView() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const addToast = useToastStore((s) => s.addToast);
  const { data: stashes = [] } = useStashList(activeRepoPath);
  const mutations = useStashMutations(activeRepoPath);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const selectedStashIndex = useSelectionStore((s) => s.selectedStashIndex);
  const selectStash = useSelectionStore((s) => s.selectStash);
  const clearFileSelection = useSelectionStore((s) => s.clearFileSelection);

  const handleApply = async (index: number) => {
    try {
      await mutations.apply.mutateAsync(index);
      addToast(t("stash.applied"), "success");
    } catch (err) {
      addToast(t("stash.failedToApply", { error: getErrorMessage(err) }), "error");
    }
  };

  const handlePop = async (index: number) => {
    try {
      await mutations.pop.mutateAsync(index);
      addToast(t("stash.popped"), "success");
    } catch (err) {
      addToast(t("stash.failedToPop", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleDrop = async (index: number) => {
    try {
      await mutations.drop.mutateAsync(index);
      addToast(t("stash.dropped"), "success");
    } catch (err) {
      addToast(t("stash.failedToDrop", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleSave = async (message?: string, paths?: string[]) => {
    try {
      const oid = paths
        ? await mutations.pushPartial.mutateAsync({ paths, message })
        : await mutations.push.mutateAsync(message);
      setShowSaveDialog(false);
      if (oid === null) {
        addToast(t("stash.nothingToSave"), "info");
        return;
      }
      clearFileSelection();
      addToast(t("stash.saved"), "success");
    } catch (err) {
      addToast(t("stash.failedToSave", { error: getErrorMessage(err) }), "error");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-8 px-3 border-b border-(--line)">
        <span className="text-[12.5px] font-bold">{t("stash.title")}</span>
        <Button size="sm" variant="ghost" icon={<Plus className="w-3 h-3" />} onClick={() => setShowSaveDialog(true)}>
          {t("stash.save")}
        </Button>
      </div>

      {/* Stash List */}
      <StashList
        stashes={stashes}
        selectedIndex={selectedStashIndex}
        onSelectStash={selectStash}
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
