import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Eye, GitBranch, Globe } from "lucide-react";
import { useBranches } from "@/api/queries";
import { useRepositoryStore } from "@/stores/repository";
import { useMenuActions } from "@/hooks/useMenuActions";
import { useCheckoutBranch } from "@/components/branch/useCheckoutBranch";
import { checkedOutBranch, useSetHistoryView } from "@/components/graph/useHistoryView";
import { ContextMenu, type ContextMenuSection } from "@/components/ui/ContextMenu";
import { copyMenuItem } from "@/components/ui/menu-items";
import type { PullRequestSummary } from "@/types";
import { headBranchRefs } from "./pr-model";
import { usePrViewStore } from "./pr-view";

const ICON = "w-3.5 h-3.5";

/**
 * PR 우클릭 메뉴(목록 줄과 상세 머리). 앱의 다른 브랜치 메뉴와 같은 동작을 쓴다: 체크아웃하지 않고
 * 보기(그래프 탭으로 옮긴다), 체크아웃(`useCheckoutBranch` — 다른 워크트리가 쓰면 그리로 이동,
 * 변경이 있으면 묻는다), 링크·번호·브랜치 이름 복사, GitHub에서 열기.
 */
export function usePrMenu(): {
  open: (pr: PullRequestSummary, position: { x: number; y: number }) => void;
  element: ReactNode;
} {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const remotes = useRepositoryStore((s) => s.activeRepo?.remotes);
  const { data: branches } = useBranches(activeRepoPath);
  const setView = useSetHistoryView();
  const { checkout, element: checkoutDialog, ready } = useCheckoutBranch();
  const [menu, setMenu] = useState<{ pr: PullRequestSummary; x: number; y: number } | null>(null);

  let menuElement: ReactNode = null;
  if (menu) {
    const { pr } = menu;
    const refs = headBranchRefs(pr, branches, (remotes ?? []).map((r) => r.name));
    const current = checkedOutBranch(branches);
    const isCurrent = refs.local !== null && refs.local === current;
    const viewTarget = refs.local ?? refs.remote;
    const sections: ContextMenuSection[] = [
      {
        items: [
          {
            label: t("pr.menu.viewBranch"),
            icon: <Eye className={ICON} />,
            onClick: () => {
              if (!viewTarget) return;
              setView({ kind: "ref", name: viewTarget, isRemote: refs.local === null });
              usePrViewStore.getState().setOpen(false);
            },
            disabled: viewTarget === null || isCurrent,
          },
          {
            label: t("pr.menu.checkout"),
            icon: <GitBranch className={ICON} />,
            onClick: () => {
              if (viewTarget) checkout(viewTarget);
            },
            disabled: viewTarget === null || isCurrent || !ready,
          },
        ],
      },
      {
        items: [
          copyMenuItem(t("pr.menu.copyLink"), pr.url, actions),
          copyMenuItem(t("pr.menu.copyNumber"), `#${pr.number}`, actions),
          copyMenuItem(t("pr.menu.copyBranch"), pr.headRef, actions),
          {
            label: t("pr.openOnGitHub"),
            icon: <Globe className={ICON} />,
            onClick: () => actions.openInBrowser(pr.url),
          },
        ],
      },
    ];
    menuElement = (
      <ContextMenu
        sections={sections}
        position={{ x: menu.x, y: menu.y }}
        onClose={() => setMenu(null)}
        ariaLabel={t("pr.menu.label", { number: pr.number })}
      />
    );
  }

  return {
    open: (pr, position) => setMenu({ pr, ...position }),
    element: (
      <>
        {menuElement}
        {checkoutDialog}
      </>
    ),
  };
}
