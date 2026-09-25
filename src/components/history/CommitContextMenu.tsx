import { useTranslation } from "react-i18next";
import { Copy, GitBranch, Globe, LogOut, RotateCcw, Undo2, Cherry } from "lucide-react";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { ContextMenuSection } from "@/components/ui/ContextMenu";
import { useMenuActions } from "@/hooks/useMenuActions";
import { gitHubCommitUrl } from "@/lib/utils";
import type { CommitInfo } from "@/types";

/** 지금 연 저장소의 커밋에만 있는 동작. 다른 저장소의 커밋(워크스페이스 그래프)에는 넘기지 않는다. */
export interface CommitMenuGitActions {
  onCreateBranch: () => void;
  onCheckout: () => void;
  onReset: () => void;
  onRevert: () => void;
  onCherryPick: () => void;
}

interface CommitContextMenuProps {
  commit: CommitInfo;
  /** 저장소의 GitHub 주소. GitHub 원격이 없으면 null(「GitHub에서 보기」를 막는다). */
  gitHubUrl: string | null;
  position: { x: number; y: number };
  /** 없으면 복사·GitHub 보기만 있는 읽기 전용 메뉴다. */
  git?: CommitMenuGitActions;
  /**
   * The commit is not in the open worktree's history (another worktree's commit drawn in the
   * same graph). Reset and revert would move this worktree onto, or undo, a change it never had.
   */
  notInHistory?: boolean;
  onClose: () => void;
}

/**
 * 커밋 행의 우클릭 메뉴(커밋 그래프, 브랜치 비교 목록). 복사·GitHub 보기는 메뉴가 직접 하고,
 * 저장소를 바꾸는 동작은 부르는 쪽이 확인 창을 거쳐 한다. 되돌릴 수 없는 reset은 맨 아래에 따로 둔다.
 */
export function CommitContextMenu({
  commit,
  gitHubUrl,
  position,
  git,
  notInHistory = false,
  onClose,
}: CommitContextMenuProps) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const icon = "w-3.5 h-3.5";
  // Merge commits cannot be cherry-picked as one change.
  const isMergeCommit = commit.parentIds.length > 1;

  const gitSections: ContextMenuSection[] = git
    ? [
        {
          items: [
            { label: t("history.contextMenu.createBranch"), icon: <GitBranch className={icon} />, onClick: git.onCreateBranch },
            { label: t("history.contextMenu.checkout"), icon: <LogOut className={icon} />, onClick: git.onCheckout },
          ],
        },
        {
          items: [
            {
              label: t("history.contextMenu.cherryPick"),
              icon: <Cherry className={icon} />,
              onClick: git.onCherryPick,
              disabled: isMergeCommit,
            },
            {
              label: t("history.contextMenu.revert"),
              icon: <Undo2 className={icon} />,
              onClick: git.onRevert,
              disabled: notInHistory,
            },
          ],
        },
      ]
    : [];

  const sections: ContextMenuSection[] = [
    ...gitSections,
    {
      items: [
        { label: t("history.contextMenu.copyHash"), icon: <Copy className={icon} />, onClick: () => actions.copy(commit.id) },
        {
          label: t("menu.copyShortSha"),
          icon: <Copy className={icon} />,
          onClick: () => actions.copy(commit.shortId),
        },
        {
          label: t("history.contextMenu.copyMessage"),
          icon: <Copy className={icon} />,
          onClick: () => actions.copy(commit.message),
        },
        {
          label: t("menu.viewOnGitHub"),
          icon: <Globe className={icon} />,
          onClick: () => {
            if (gitHubUrl) actions.openInBrowser(gitHubCommitUrl(gitHubUrl, commit.id));
          },
          disabled: gitHubUrl === null,
        },
      ],
    },
    ...(git
      ? [
          {
            items: [
              {
                label: t("history.contextMenu.reset"),
                icon: <RotateCcw className={icon} />,
                variant: "danger" as const,
                onClick: git.onReset,
                disabled: notInHistory,
              },
            ],
          },
        ]
      : []),
  ];

  return <ContextMenu sections={sections} position={position} onClose={onClose} ariaLabel={t("menu.commitMenu")} />;
}
