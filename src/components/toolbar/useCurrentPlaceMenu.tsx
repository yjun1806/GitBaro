import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useMenuActions } from "@/hooks/useMenuActions";
import { ContextMenu, contextMenuPoint, type ContextMenuSection } from "@/components/ui/ContextMenu";
import { copyMenuItem, folderMenuItems } from "@/components/ui/menu-items";
import { gitHubBranchUrl, gitHubRepoUrl } from "@/lib/utils";

const ICON = "w-3.5 h-3.5";

/**
 * 툴바의 브랜치 칸·워크트리 칩 우클릭 메뉴. 둘 다 「지금 연 곳」(워크트리 폴더 + 브랜치)을 가리키므로
 * 같은 메뉴를 쓴다: 브랜치 이름·경로 복사, 폴더 열기, GitHub에서 브랜치 보기.
 */
export function useCurrentPlaceMenu(branch: string | null): {
  onContextMenu: (e: React.MouseEvent) => void;
  element: ReactNode;
} {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const path = useRepositoryStore((s) => s.activeRepoPath);
  const gitHubUrl = useRepositoryStore((s) => gitHubRepoUrl(s.activeRepo?.remotes ?? []));
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  let element: ReactNode = null;
  if (at && path) {
    const sections: ContextMenuSection[] = [
      {
        items: [
          ...(branch ? [copyMenuItem(t("branch.contextMenu.copyName"), branch, actions)] : []),
          copyMenuItem(t("menu.copyPath"), path, actions),
        ],
      },
      { items: folderMenuItems(t, actions, path) },
      {
        items: [
          {
            label: t("menu.viewOnGitHub"),
            icon: <Globe className={ICON} />,
            onClick: () => {
              if (gitHubUrl && branch) actions.openInBrowser(gitHubBranchUrl(gitHubUrl, branch));
            },
            disabled: gitHubUrl === null || branch === null,
          },
        ],
      },
    ];
    element = (
      <ContextMenu sections={sections} position={at} onClose={() => setAt(null)} ariaLabel={t("menu.placeMenu")} />
    );
  }

  return {
    onContextMenu: (e) => {
      if (!path) return;
      e.preventDefault();
      setAt(contextMenuPoint(e));
    },
    element,
  };
}
