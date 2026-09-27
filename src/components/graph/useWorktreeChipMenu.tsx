import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Focus, FolderGit2 } from "lucide-react";
import { useWorktrees } from "@/api/queries";
import { useOwnerRepoPath, useRepositoryStore } from "@/stores/repository";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { useMenuActions } from "@/hooks/useMenuActions";
import { ContextMenu, type ContextMenuSection } from "@/components/ui/ContextMenu";
import { copyMenuItem, folderMenuItems } from "@/components/ui/menu-items";
import type { WorktreeChip } from "./WorktreeLaneChips";

const ICON = "w-3.5 h-3.5";

export interface WorktreeChipMenuFilter {
  visible: ReadonlySet<string>;
  toggle: (path: string) => void;
  /** 이 워크트리만 함께 본다(지금 연 워크트리는 늘 보인다). */
  showOnly: (path: string) => void;
}

/**
 * 「함께 보는 워크트리」 칩의 우클릭 메뉴: 이 워크트리만 함께 보기, 켜기·끄기, 그 워크트리 열기,
 * 폴더 열기·경로 복사. 지금 연 워크트리 칩은 늘 보이므로 켜고 끄는 항목을 막는다.
 */
export function useWorktreeChipMenu(filter: WorktreeChipMenuFilter): {
  open: (chip: WorktreeChip, position: { x: number; y: number }) => void;
  element: ReactNode;
} {
  const [menu, setMenu] = useState<{ chip: WorktreeChip; x: number; y: number } | null>(null);
  // 워크트리 목록 조회는 메뉴를 열 때만 붙인다.
  const element = menu ? (
    <WorktreeChipMenu
      chip={menu.chip}
      filter={filter}
      position={{ x: menu.x, y: menu.y }}
      onClose={() => setMenu(null)}
    />
  ) : null;
  return { open: (chip, { x, y }) => setMenu({ chip, x, y }), element };
}

function WorktreeChipMenu({
  chip,
  filter,
  position,
  onClose,
}: {
  chip: WorktreeChip;
  filter: WorktreeChipMenuFilter;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const ownerRepoPath = useOwnerRepoPath();
  const { data: worktrees = [] } = useWorktrees(ownerRepoPath);
  const openWorktree = useOpenWorktree(activeRepoPath, worktrees);
  const shown = chip.isCurrent || filter.visible.has(chip.path);
  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          label: t("menu.chipShowOnly"),
          icon: <Focus className={ICON} />,
          onClick: () => filter.showOnly(chip.path),
          disabled: chip.isCurrent,
        },
        {
          label: shown ? t("menu.chipHide") : t("menu.chipShow"),
          icon: shown ? <EyeOff className={ICON} /> : <Eye className={ICON} />,
          onClick: () => filter.toggle(chip.path),
          disabled: chip.isCurrent,
        },
      ],
    },
    {
      items: [
        {
          label: t("menu.openWorktree"),
          icon: <FolderGit2 className={ICON} />,
          onClick: () => void openWorktree(chip.path),
          disabled: chip.isCurrent,
        },
        ...folderMenuItems(t, actions, chip.path),
      ],
    },
    {
      items: [
        copyMenuItem(t("menu.copyPath"), chip.path, actions),
        ...(chip.branch ? [copyMenuItem(t("branch.contextMenu.copyName"), chip.branch, actions)] : []),
      ],
    },
  ];
  return <ContextMenu sections={sections} position={position} onClose={onClose} ariaLabel={t("menu.worktreeMenu")} />;
}
