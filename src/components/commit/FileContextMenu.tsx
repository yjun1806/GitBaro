import { useTranslation } from "react-i18next";
import {
  Plus,
  Minus,
  Code2,
  FolderOpen,
  Copy,
  EyeOff,
  Undo2,
} from "lucide-react";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { ContextMenuSection } from "@/components/ui/ContextMenu";

interface FileContextMenuProps {
  staged: boolean;
  canDiscard: boolean;
  position: { x: number; y: number };
  onToggleStage: () => void;
  onOpenEditor: () => void;
  onReveal: () => void;
  onCopyPath: () => void;
  onAddToGitignore: () => void;
  onDiscard: () => void;
  onClose: () => void;
}

export function FileContextMenu({
  staged,
  canDiscard,
  position,
  onToggleStage,
  onOpenEditor,
  onReveal,
  onCopyPath,
  onAddToGitignore,
  onDiscard,
  onClose,
}: FileContextMenuProps) {
  const { t } = useTranslation();

  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          label: staged ? t("changes.contextMenu.unstage") : t("changes.contextMenu.stage"),
          icon: staged ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />,
          onClick: onToggleStage,
        },
      ],
    },
    {
      items: [
        {
          label: t("changes.contextMenu.openInEditor"),
          icon: <Code2 className="w-3.5 h-3.5" />,
          onClick: onOpenEditor,
        },
        {
          label: t("changes.contextMenu.revealInFinder"),
          icon: <FolderOpen className="w-3.5 h-3.5" />,
          onClick: onReveal,
        },
      ],
    },
    {
      items: [
        {
          label: t("changes.contextMenu.copyPath"),
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: onCopyPath,
        },
        {
          label: t("changes.contextMenu.addToGitignore"),
          icon: <EyeOff className="w-3.5 h-3.5" />,
          onClick: onAddToGitignore,
        },
      ],
    },
    {
      items: [
        {
          label: t("changes.contextMenu.discard"),
          icon: <Undo2 className="w-3.5 h-3.5" />,
          variant: "danger" as const,
          onClick: onDiscard,
          disabled: !canDiscard,
        },
      ],
    },
  ];

  return <ContextMenu sections={sections} position={position} onClose={onClose} />;
}
