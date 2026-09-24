import { useTranslation } from "react-i18next";
import {
  Copy,
  GitBranch,
  LogOut,
  RotateCcw,
  Undo2,
  Cherry,
} from "lucide-react";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { ContextMenuSection } from "@/components/ui/ContextMenu";

interface CommitContextMenuProps {
  position: { x: number; y: number };
  onCopyHash: () => void;
  onCopyMessage: () => void;
  onCreateBranch: () => void;
  onCheckout: () => void;
  onReset: () => void;
  onRevert: () => void;
  onCherryPick: () => void;
  /** Merge commits cannot be cherry-picked as one change. */
  isMergeCommit: boolean;
  /**
   * The commit is not in the open worktree's history (another worktree's commit drawn in the
   * same graph). Reset and revert would move this worktree onto, or undo, a change it never had.
   */
  notInHistory?: boolean;
  onClose: () => void;
}

export function CommitContextMenu({
  position,
  onCopyHash,
  onCopyMessage,
  onCreateBranch,
  onCheckout,
  onReset,
  onRevert,
  onCherryPick,
  isMergeCommit,
  notInHistory = false,
  onClose,
}: CommitContextMenuProps) {
  const { t } = useTranslation();

  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          label: t("history.contextMenu.createBranch"),
          icon: <GitBranch className="w-3.5 h-3.5" />,
          onClick: onCreateBranch,
        },
        {
          label: t("history.contextMenu.checkout"),
          icon: <LogOut className="w-3.5 h-3.5" />,
          onClick: onCheckout,
        },
      ],
    },
    {
      items: [
        {
          label: t("history.contextMenu.reset"),
          icon: <RotateCcw className="w-3.5 h-3.5" />,
          onClick: onReset,
          disabled: notInHistory,
        },
        {
          label: t("history.contextMenu.revert"),
          icon: <Undo2 className="w-3.5 h-3.5" />,
          onClick: onRevert,
          disabled: notInHistory,
        },
        {
          label: t("history.contextMenu.cherryPick"),
          icon: <Cherry className="w-3.5 h-3.5" />,
          onClick: onCherryPick,
          disabled: isMergeCommit,
        },
      ],
    },
    {
      items: [
        {
          label: t("history.contextMenu.copyHash"),
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: onCopyHash,
        },
        {
          label: t("history.contextMenu.copyMessage"),
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: onCopyMessage,
        },
      ],
    },
  ];

  return <ContextMenu sections={sections} position={position} onClose={onClose} />;
}
