import { useTranslation } from "react-i18next";
import { Globe, Copy } from "lucide-react";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { ContextMenuSection } from "@/components/ui/ContextMenu";

interface ActionsRunContextMenuProps {
  hasUrl: boolean;
  position: { x: number; y: number };
  onOpenBrowser: () => void;
  onCopyUrl: () => void;
  onClose: () => void;
}

export function ActionsRunContextMenu({
  hasUrl,
  position,
  onOpenBrowser,
  onCopyUrl,
  onClose,
}: ActionsRunContextMenuProps) {
  const { t } = useTranslation();

  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          label: t("actions.contextMenu.openInBrowser"),
          icon: <Globe className="w-3.5 h-3.5" />,
          onClick: onOpenBrowser,
          disabled: !hasUrl,
        },
        {
          label: t("actions.contextMenu.copyUrl"),
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: onCopyUrl,
          disabled: !hasUrl,
        },
      ],
    },
  ];

  return (
    <ContextMenu sections={sections} position={position} onClose={onClose} />
  );
}
