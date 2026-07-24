import { useTranslation } from "react-i18next";
import { FolderOpen, Copy, Trash2 } from "lucide-react";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { ContextMenuSection } from "@/components/ui/ContextMenu";

interface WorktreeContextMenuProps {
  isLocked: boolean;
  position: { x: number; y: number };
  onOpen: () => void;
  onCopyPath: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export function WorktreeContextMenu({
  isLocked,
  position,
  onOpen,
  onCopyPath,
  onRemove,
  onClose,
}: WorktreeContextMenuProps) {
  const { t } = useTranslation();

  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          label: t("worktree.contextMenu.open"),
          icon: <FolderOpen className="w-3.5 h-3.5" />,
          onClick: onOpen,
        },
        {
          label: t("worktree.contextMenu.copyPath"),
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: onCopyPath,
        },
      ],
    },
    {
      items: [
        {
          label: t("worktree.remove"),
          icon: <Trash2 className="w-3.5 h-3.5" />,
          variant: "danger" as const,
          onClick: onRemove,
          disabled: isLocked,
        },
      ],
    },
  ];

  return (
    <ContextMenu sections={sections} position={position} onClose={onClose} />
  );
}
