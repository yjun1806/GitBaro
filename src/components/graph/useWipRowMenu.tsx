import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Eye, FolderGit2, ListChecks } from "lucide-react";
import { useStashMutations, useWorktrees } from "@/api/queries";
import { useOwnerRepoPath, useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useToastStore } from "@/stores/toast";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { useMenuActions } from "@/hooks/useMenuActions";
import { useOpenWorkingChanges } from "@/components/commit/useOpenWorkingChanges";
import { ContextMenu, type ContextMenuSection } from "@/components/ui/ContextMenu";
import { copyMenuItem, folderMenuItems } from "@/components/ui/menu-items";
import { getErrorMessage } from "@/lib/utils";
import type { GraphWip } from "./graph-model";

const ICON = "w-3.5 h-3.5";

/**
 * 커밋 그래프 WIP 행(워크트리 하나의 커밋 안 한 변경)의 우클릭 메뉴.
 * 변경 보기(따라가기), 지금 연 워크트리면 스테이징 목록 열기와 Stash, 다른 워크트리면 그 워크트리 열기,
 * 그리고 폴더 열기·경로 복사. 모든 변경 되돌리기는 이 앱에 한 번에 하는 흐름이 없어 두지 않는다.
 */
export function useWipRowMenu(onShowChanges: (wip: GraphWip) => void): {
  open: (wip: GraphWip, position: { x: number; y: number }) => void;
  element: ReactNode;
} {
  const [menu, setMenu] = useState<{ wip: GraphWip; x: number; y: number } | null>(null);
  // 메뉴가 쓰는 조회(워크트리 목록, stash)는 메뉴를 열 때만 붙인다.
  const element = menu ? (
    <WipRowMenu
      wip={menu.wip}
      position={{ x: menu.x, y: menu.y }}
      onShowChanges={onShowChanges}
      onClose={() => setMenu(null)}
    />
  ) : null;
  return { open: (wip, { x, y }) => setMenu({ wip, x, y }), element };
}

function WipRowMenu({
  wip,
  position,
  onShowChanges,
  onClose,
}: {
  wip: GraphWip;
  position: { x: number; y: number };
  onShowChanges: (wip: GraphWip) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const ownerRepoPath = useOwnerRepoPath();
  const { data: worktrees = [] } = useWorktrees(ownerRepoPath);
  const openWorktree = useOpenWorktree(activeRepoPath, worktrees);
  const openWorkingChanges = useOpenWorkingChanges();
  const stashMutations = useStashMutations(activeRepoPath);

  // 툴바·따라가기 칸의 Stash와 같은 결과(메시지 없이 전부 넣는다).
  const stash = async () => {
    try {
      const oid = await stashMutations.push.mutateAsync(undefined);
      if (oid === null) {
        addToast(t("stash.nothingToSave"), "info");
        return;
      }
      useSelectionStore.getState().clearFileSelection();
      await queryClient.invalidateQueries({ queryKey: ["wipFiles"] });
      addToast(t("stash.saved"), "success");
    } catch (err) {
      addToast(t("stash.failedToSave", { error: getErrorMessage(err) }), "error");
    }
  };

  const hasChanges = (wip.count ?? 0) > 0;
  const sections: ContextMenuSection[] = [
    {
      items: [
        { label: t("menu.showChanges"), icon: <Eye className={ICON} />, onClick: () => onShowChanges(wip) },
        wip.isCurrent
          ? {
              label: t("menu.openStaging"),
              icon: <ListChecks className={ICON} />,
              onClick: openWorkingChanges,
              disabled: !hasChanges,
            }
          : {
              label: t("menu.openWorktree"),
              icon: <FolderGit2 className={ICON} />,
              onClick: () => void openWorktree(wip.path),
            },
        ...(wip.isCurrent
          ? [
              {
                label: t("stash.save"),
                icon: <Archive className={ICON} />,
                onClick: () => void stash(),
                disabled: !hasChanges,
              },
            ]
          : []),
      ],
    },
    { items: folderMenuItems(t, actions, wip.path) },
    {
      items: [
        copyMenuItem(t("menu.copyPath"), wip.path, actions),
        ...(wip.branch ? [copyMenuItem(t("branch.contextMenu.copyName"), wip.branch, actions)] : []),
      ],
    },
  ];
  return <ContextMenu sections={sections} position={position} onClose={onClose} ariaLabel={t("menu.wipMenu")} />;
}
