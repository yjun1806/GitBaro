import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, GitBranch, GitCompare, Globe, Trash2 } from "lucide-react";
import { deleteBranch } from "@/api/commands";
import { useBranches } from "@/api/queries";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { useUIStore } from "@/stores/ui";
import { useHistoryViewStore } from "@/stores/history-view";
import { useMenuActions } from "@/hooks/useMenuActions";
import { useBranchRangeStore } from "@/components/branch/branch-range";
import { useCheckoutBranch } from "@/components/branch/useCheckoutBranch";
import { DeleteBranchDialog } from "@/components/branch/DeleteBranchDialog";
import { ContextMenu, type ContextMenuSection } from "@/components/ui/ContextMenu";
import { copyMenuItem } from "@/components/ui/menu-items";
import { getErrorMessage, gitHubBranchUrl, gitHubRemoteBranchUrl, gitHubRepoUrl } from "@/lib/utils";
import type { RefLabel } from "@/types";
import { checkedOutBranch, useSetHistoryView } from "./useHistoryView";

const ICON = "w-3.5 h-3.5";

/** 브랜치를 지운 뒤 다시 읽을 쿼리(툴바 브랜치 패널의 삭제와 같다). */
const DELETE_QUERY_KEYS = ["branches", "repoSyncStatus", "commitHistory", "recentBranches", "changesVsDefault"];

/**
 * 커밋 그래프의 브랜치·태그 이름표 우클릭 메뉴. 동작은 툴바 브랜치 패널과 같다:
 * 체크아웃하지 않고 보기, 체크아웃(다른 워크트리가 쓰면 그 워크트리로 이동, 변경이 있으면 묻는다),
 * 지금 브랜치와 비교(그래프 범위 모드), 이름 복사, GitHub에서 보기, 그리고 맨 아래에 로컬 브랜치 삭제(확인 창).
 * 태그는 복사와 GitHub 보기만 있다.
 */
export function useRefLabelMenu(): {
  open: (label: RefLabel, position: { x: number; y: number }) => void;
  element: ReactNode;
} {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const gitHubUrl = useRepositoryStore((s) => gitHubRepoUrl(s.activeRepo?.remotes ?? []));
  const remotes = useRepositoryStore((s) => s.activeRepo?.remotes);
  const { data: branches } = useBranches(activeRepoPath);
  const currentBranch = checkedOutBranch(branches);
  const setView = useSetHistoryView();
  const { checkout, element: checkoutDialog } = useCheckoutBranch();
  const [menu, setMenu] = useState<{ label: RefLabel; x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const compareWithCurrent = (name: string) => {
    if (!activeRepoPath || !currentBranch) return;
    useHistoryViewStore.getState().reset();
    useBranchRangeStore.getState().setRange({ repoPath: activeRepoPath, base: currentBranch, target: name, head: currentBranch });
    useUIStore.getState().setActiveTab("history");
  };

  const handleDelete = async () => {
    if (!activeRepoPath || !pendingDelete) return;
    const name = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteBranch(activeRepoPath, name);
      addToast(t("branch.deleted", { name }), "success");
    } catch (err) {
      addToast(t("branch.failedToDelete", { error: getErrorMessage(err) }), "error");
    } finally {
      await Promise.all(DELETE_QUERY_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    }
  };

  let menuElement: ReactNode = null;
  if (menu) {
    const { label } = menu;
    const isTag = label.kind === "tag";
    const isRemote = label.kind === "remoteBranch";
    const info = branches?.find((b) => b.name === label.name && b.isRemote === isRemote);
    // 태그는 저장소 주소로, 브랜치는 그 원격 브랜치(로컬이면 추적 브랜치)의 원격 주소로 연다.
    const remoteRef = isRemote ? label.name : (info?.upstream ?? null);
    const branchUrl = isTag
      ? gitHubUrl && gitHubBranchUrl(gitHubUrl, label.name)
      : remoteRef
        ? gitHubRemoteBranchUrl(remotes ?? [], remoteRef)
        : null;
    const isCurrent = !isRemote && !isTag && label.name === currentBranch;
    const sections: ContextMenuSection[] = [];
    if (!isTag) {
      sections.push(
        {
          items: [
            {
              label: t("menu.viewBranch"),
              icon: <Eye className={ICON} />,
              onClick: () => setView({ kind: "ref", name: label.name, isRemote }),
              disabled: isCurrent,
            },
            {
              label: t("branch.contextMenu.checkout"),
              icon: <GitBranch className={ICON} />,
              onClick: () => checkout(label.name),
              disabled: isCurrent,
            },
          ],
        },
        {
          items: [
            {
              label: t("branch.contextMenu.compare"),
              icon: <GitCompare className={ICON} />,
              onClick: () => compareWithCurrent(label.name),
              disabled: isCurrent || currentBranch === null,
            },
          ],
        },
      );
    }
    sections.push({
      items: [
        copyMenuItem(isTag ? t("menu.copyTagName") : t("branch.contextMenu.copyName"), label.name, actions),
        {
          label: t("menu.viewOnGitHub"),
          icon: <Globe className={ICON} />,
          onClick: () => {
            if (branchUrl) actions.openInBrowser(branchUrl);
          },
          // 로컬에만 있는 브랜치는 GitHub에 없다.
          disabled: branchUrl === null,
        },
      ],
    });
    if (label.kind === "localBranch") {
      sections.push({
        items: [
          {
            label: t("menu.deleteBranch"),
            icon: <Trash2 className={ICON} />,
            variant: "danger",
            onClick: () => setPendingDelete(label.name),
            disabled: isCurrent || info?.isDefault === true,
          },
        ],
      });
    }
    menuElement = (
      <ContextMenu
        sections={sections}
        position={{ x: menu.x, y: menu.y }}
        onClose={() => setMenu(null)}
        ariaLabel={isTag ? t("menu.tagMenu") : t("menu.branchMenu")}
      />
    );
  }

  const element = (
    <>
      {menuElement}
      {checkoutDialog}
      {pendingDelete && (
        <DeleteBranchDialog
          branchName={pendingDelete}
          isFullyMerged={branches?.find((b) => b.name === pendingDelete && !b.isRemote)?.isFullyMerged ?? false}
          onConfirm={() => void handleDelete()}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  );

  // 그래프 행(`memo`)에 넘기므로 렌더마다 새 함수를 만들지 않는다.
  const open = useCallback((label: RefLabel, { x, y }: { x: number; y: number }) => setMenu({ label, x, y }), []);
  return { open, element };
}
