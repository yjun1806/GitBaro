import { useTranslation } from "react-i18next";
import { Globe, Copy } from "lucide-react";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { ContextMenuSection } from "@/components/ui/ContextMenu";
import { copyMenuItem } from "@/components/ui/menu-items";
import { useMenuActions } from "@/hooks/useMenuActions";
import type { WorkflowRun } from "@/types";

interface ActionsRunContextMenuProps {
  run: WorkflowRun;
  position: { x: number; y: number };
  onClose: () => void;
}

/** Actions 실행 항목 우클릭 메뉴: 브라우저에서 열기, 주소·커밋 SHA·브랜치 이름 복사. */
export function ActionsRunContextMenu({ run, position, onClose }: ActionsRunContextMenuProps) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const hasUrl = run.htmlUrl !== "";

  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          label: t("actions.contextMenu.openInBrowser"),
          icon: <Globe className="w-3.5 h-3.5" />,
          onClick: () => actions.openInBrowser(run.htmlUrl),
          disabled: !hasUrl,
        },
        {
          label: t("actions.contextMenu.copyUrl"),
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: () => actions.copy(run.htmlUrl),
          disabled: !hasUrl,
        },
      ],
    },
    {
      items: [
        copyMenuItem(t("history.contextMenu.copyHash"), run.headSha, actions),
        copyMenuItem(t("branch.contextMenu.copyName"), run.headBranch, actions),
      ],
    },
  ];

  return <ContextMenu sections={sections} position={position} onClose={onClose} ariaLabel={t("menu.runMenu")} />;
}
