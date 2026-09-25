import { useTranslation } from "react-i18next";
import { Eye, GitBranch, GitCompare, GitMerge, Globe, Pencil, Trash2, Copy } from "lucide-react";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { ContextMenuSection } from "@/components/ui/ContextMenu";

interface BranchContextMenuProps {
  isCurrent: boolean;
  isDefault: boolean;
  /** Remote-only branch: rename and delete only work on local branches. */
  isRemote: boolean;
  /** 이 브랜치를 체크아웃하지 않고 보는 중인지(「보기」를 막는다). */
  isViewed?: boolean;
  position: { x: number; y: number };
  onView: () => void;
  onCheckout: () => void;
  onCompare: () => void;
  onMerge: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyName: () => void;
  /** GitHub에서 브랜치를 연다. GitHub에 없는 브랜치면 undefined(항목을 막는다). */
  onOpenOnGitHub?: () => void;
  onClose: () => void;
}

/**
 * 브랜치 패널 행의 우클릭 메뉴. 보기·체크아웃, 비교·Merge, 복사·GitHub, 이름 변경,
 * 그리고 맨 아래에 따로 삭제(확인 창)를 둔다.
 */
export function BranchContextMenu({
  isCurrent,
  isDefault,
  isRemote,
  isViewed = false,
  position,
  onView,
  onCheckout,
  onCompare,
  onMerge,
  onRename,
  onDelete,
  onCopyName,
  onOpenOnGitHub,
  onClose,
}: BranchContextMenuProps) {
  const { t } = useTranslation();
  const icon = "w-3.5 h-3.5";

  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          label: t("menu.viewBranch"),
          icon: <Eye className={icon} />,
          onClick: onView,
          disabled: isCurrent || isViewed,
        },
        {
          label: t("branch.contextMenu.checkout"),
          icon: <GitBranch className={icon} />,
          onClick: onCheckout,
          disabled: isCurrent,
        },
      ],
    },
    {
      items: [
        {
          label: t("branch.contextMenu.compare"),
          icon: <GitCompare className={icon} />,
          onClick: onCompare,
          disabled: isCurrent,
        },
        {
          label: t("branch.contextMenu.merge"),
          icon: <GitMerge className={icon} />,
          onClick: onMerge,
          disabled: isCurrent,
        },
      ],
    },
    {
      items: [
        {
          label: t("branch.contextMenu.copyName"),
          icon: <Copy className={icon} />,
          onClick: onCopyName,
        },
        {
          label: t("menu.viewOnGitHub"),
          icon: <Globe className={icon} />,
          onClick: () => onOpenOnGitHub?.(),
          disabled: !onOpenOnGitHub,
        },
        {
          label: t("branch.contextMenu.rename"),
          icon: <Pencil className={icon} />,
          onClick: onRename,
          disabled: isDefault || isRemote,
        },
      ],
    },
    {
      items: [
        {
          label: t("branch.contextMenu.delete"),
          icon: <Trash2 className={icon} />,
          onClick: onDelete,
          variant: "danger" as const,
          disabled: isCurrent || isDefault || isRemote,
        },
      ],
    },
  ];

  return <ContextMenu sections={sections} position={position} onClose={onClose} ariaLabel={t("menu.branchMenu")} />;
}
