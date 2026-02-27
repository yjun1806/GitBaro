import { useTranslation } from "react-i18next";
import {
  GitBranch,
  GitCompare,
  GitMerge,
  Pencil,
  Trash2,
  Copy,
} from "lucide-react";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { ContextMenuSection } from "@/components/ui/ContextMenu";

interface BranchContextMenuProps {
  isCurrent: boolean;
  isDefault: boolean;
  position: { x: number; y: number };
  onCheckout: () => void;
  onCompare: () => void;
  onMerge: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyName: () => void;
  onClose: () => void;
}

export function BranchContextMenu({
  isCurrent,
  isDefault,
  position,
  onCheckout,
  onCompare,
  onMerge,
  onRename,
  onDelete,
  onCopyName,
  onClose,
}: BranchContextMenuProps) {
  const { t } = useTranslation();

  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          label: t("branch.contextMenu.checkout"),
          icon: <GitBranch className="w-3.5 h-3.5" />,
          onClick: onCheckout,
          disabled: isCurrent,
        },
      ],
    },
    {
      items: [
        {
          label: t("branch.contextMenu.compare"),
          icon: <GitCompare className="w-3.5 h-3.5" />,
          onClick: onCompare,
          disabled: isCurrent,
        },
        {
          label: t("branch.contextMenu.merge"),
          icon: <GitMerge className="w-3.5 h-3.5" />,
          onClick: onMerge,
          disabled: isCurrent,
        },
      ],
    },
    {
      items: [
        {
          label: t("branch.contextMenu.rename"),
          icon: <Pencil className="w-3.5 h-3.5" />,
          onClick: onRename,
          disabled: isDefault,
        },
        {
          label: t("branch.contextMenu.delete"),
          icon: <Trash2 className="w-3.5 h-3.5" />,
          onClick: onDelete,
          variant: "danger" as const,
          disabled: isCurrent || isDefault,
        },
      ],
    },
    {
      items: [
        {
          label: t("branch.contextMenu.copyName"),
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: onCopyName,
        },
      ],
    },
  ];

  return (
    <ContextMenu sections={sections} position={position} onClose={onClose} />
  );
}
