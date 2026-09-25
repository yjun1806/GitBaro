import type { TFunction } from "i18next";
import { Code2, Copy, FolderOpen, Terminal } from "lucide-react";
import type { MenuActions } from "@/hooks/useMenuActions";
import type { ContextMenuItem } from "./ContextMenu";

const ICON = "w-3.5 h-3.5";

/** 폴더(저장소·워크트리)를 Finder·터미널·편집기에서 여는 항목. */
export function folderMenuItems(t: TFunction, actions: MenuActions, path: string): ContextMenuItem[] {
  return [
    {
      label: t("menu.revealInFinder"),
      icon: <FolderOpen className={ICON} />,
      onClick: () => actions.reveal(path),
    },
    {
      label: t("menu.openInTerminal"),
      icon: <Terminal className={ICON} />,
      onClick: () => actions.openTerminal(path),
    },
    {
      label: t("menu.openInEditor"),
      icon: <Code2 className={ICON} />,
      onClick: () => actions.openFolderInEditor(path),
    },
  ];
}

/** 글 하나를 복사하는 항목. */
export function copyMenuItem(label: string, text: string, actions: MenuActions): ContextMenuItem {
  return { label, icon: <Copy className={ICON} />, onClick: () => actions.copy(text) };
}
