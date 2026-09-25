import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMenuActions } from "@/hooks/useMenuActions";
import { ContextMenu } from "./ContextMenu";
import { copyMenuItem, folderMenuItems } from "./menu-items";

/** 폴더(저장소·워크트리) 하나의 우클릭 메뉴: Finder·터미널·편집기에서 열기, 경로(와 브랜치) 복사. */
export function useFolderMenu(): {
  open: (target: { path: string; branch?: string | null }, position: { x: number; y: number }) => void;
  element: ReactNode;
} {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const [menu, setMenu] = useState<{ path: string; branch: string | null; x: number; y: number } | null>(null);
  const element = menu ? (
    <ContextMenu
      sections={[
        { items: folderMenuItems(t, actions, menu.path) },
        {
          items: [
            copyMenuItem(t("menu.copyPath"), menu.path, actions),
            ...(menu.branch ? [copyMenuItem(t("branch.contextMenu.copyName"), menu.branch, actions)] : []),
          ],
        },
      ]}
      position={{ x: menu.x, y: menu.y }}
      onClose={() => setMenu(null)}
      ariaLabel={t("menu.worktreeMenu")}
    />
  ) : null;
  return { open: ({ path, branch = null }, { x, y }) => setMenu({ path, branch, x, y }), element };
}
